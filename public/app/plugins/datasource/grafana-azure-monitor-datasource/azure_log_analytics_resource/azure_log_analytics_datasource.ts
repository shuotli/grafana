import _ from 'lodash';
import LogAnalyticsQuerystringBuilder from '../log_analytics/querystring_builder';
import ResponseParser from '../response_parser';
import { AzureMonitorQuery, AzureDataSourceJsonData, AzureLogsVariable, AzureQueryType } from '../types';
import {
  DataQueryRequest,
  DataQueryResponse,
  ScopedVars,
  DataSourceInstanceSettings,
  MetricFindValue,
} from '@grafana/data';
import { getBackendSrv, getTemplateSrv, DataSourceWithBackend } from '@grafana/runtime';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

export default class azureResourceLogAnalyticsDatasource extends DataSourceWithBackend<
  AzureMonitorQuery,
  AzureDataSourceJsonData
> {
  url: string;
  baseUrl: string;
  applicationId: string;
  azureMonitorUrl: string;
  defaultOrFirstResource: string;
  subscriptionId: string;
  cache: Map<string, any>;

  constructor(private instanceSettings: DataSourceInstanceSettings<AzureDataSourceJsonData>) {
    super(instanceSettings);
    this.cache = new Map();

    switch (this.instanceSettings.jsonData.cloudName) {
      case 'govazuremonitor': // Azure US Government
        this.baseUrl = '/govresourceloganalyticsazure';
        break;
      case 'germanyazuremonitor': // Azure Germany
        break;
      case 'chinaazuremonitor': // Azure China
        this.baseUrl = '/chinaresourceloganalyticsazure';
        break;
      default:
        // Azure Global
        this.baseUrl = '/resourceloganalyticsazure';
    }

    this.url = instanceSettings.url || '';
    this.defaultOrFirstResource = this.instanceSettings.jsonData.logAnalyticsDefaultResource || '';

    this.setResourceUrl();
  }

  isConfigured(): boolean {
    return (
      (!!this.instanceSettings.jsonData.logAnalyticsSubscriptionId &&
        this.instanceSettings.jsonData.logAnalyticsSubscriptionId.length > 0) ||
      !!this.instanceSettings.jsonData.azureResourceLogAnalyticsSameAs
    );
  }

  setResourceUrl() {
    if (!!this.instanceSettings.jsonData.subscriptionId || !!this.instanceSettings.jsonData.azureLogAnalyticsSameAs) {
      this.subscriptionId = this.instanceSettings.jsonData.subscriptionId;
      const azureCloud = this.instanceSettings.jsonData.cloudName || 'azuremonitor';
      this.azureMonitorUrl = `/${azureCloud}/subscriptions`;
    } else {
      this.subscriptionId = this.instanceSettings.jsonData.logAnalyticsSubscriptionId || '';

      switch (this.instanceSettings.jsonData.cloudName) {
        case 'govazuremonitor': // Azure US Government
          this.azureMonitorUrl = `/govresourceloganalyticsazure/subscriptions`;
          break;
        case 'germanyazuremonitor': // Azure Germany
          break;
        case 'chinaazuremonitor': // Azure China
          this.azureMonitorUrl = `/chinaresourceloganalyticsazure/subscriptions`;
          break;
        default:
          // Azure Global
          this.azureMonitorUrl = `/resourceloganalyticsazure/subscriptions`;
      }
    }
  }

  async getResources(subscription: string): Promise<AzureLogsVariable[]> {
    const result = await getBackendSrv().datasourceRequest({
      url: this.url + `/azuremonitor/providers/Microsoft.ResourceGraph/resources?api-version=2019-04-01`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { subscriptions: [this.subscriptionId], query: 'project id, name' },
    });

    return (
      _.map(result.data.data.rows, (val: any) => {
        return { text: val[1], value: val[0] };
      }) || []
    );
  }

  getWorkspaceList(subscription: string): Promise<any> {
    const subscriptionId = getTemplateSrv().replace(subscription || this.subscriptionId);

    const workspaceListUrl =
      this.azureMonitorUrl +
      `/${subscriptionId}/providers/Microsoft.OperationalInsights/workspaces?api-version=2017-04-26-preview`;
    return this.doRequest(workspaceListUrl, 'GET', true);
  }

  getSchema(resource: string) {
    if (!resource) {
      return Promise.resolve();
    }

    const url = `${this.baseUrl}${getTemplateSrv().replace(resource, {})}/metadata`;

    return this.doRequest(url, 'POST').then((response: any) => {
      return new ResponseParser(response.data).parseSchemaResult();
    });
  }

  applyTemplateVariables(target: AzureMonitorQuery, scopedVars: ScopedVars): Record<string, any> {
    const item = target.azureResourceLogAnalytics;

    const templateSrv = getTemplateSrv();
    let resource = templateSrv.replace(item.resource, scopedVars);

    if (!resource && this.defaultOrFirstResource) {
      resource = this.defaultOrFirstResource;
    }

    const subscriptionId = templateSrv.replace(target.subscription || this.subscriptionId, scopedVars);
    const query = templateSrv.replace(item.query, scopedVars, this.interpolateVariable);

    return {
      refId: target.refId,
      format: target.format,
      queryType: AzureQueryType.ResourceLogAnalytics,
      subscriptionId: subscriptionId,
      azureResourceLogAnalytics: {
        resultFormat: item.resultFormat,
        query: query,
        resource: resource,
      },
    };
  }

  /**
   * Augment the results with links back to the azure console
   */
  query(request: DataQueryRequest<AzureMonitorQuery>): Observable<DataQueryResponse> {
    return super.query(request).pipe(
      mergeMap((res: DataQueryResponse) => {
        return from(this.processResponse(res));
      })
    );
  }

  async processResponse(res: DataQueryResponse): Promise<DataQueryResponse> {
    if (res.data) {
      for (const df of res.data) {
        const encodedQuery = df.meta?.custom?.encodedQuery;
        if (encodedQuery && encodedQuery.length > 0) {
          const url = await this.buildDeepLink(df.meta.custom);
          if (url?.length) {
            for (const field of df.fields) {
              field.config.links = [
                {
                  url: url,
                  title: 'View in Azure Portal',
                  targetBlank: true,
                },
              ];
            }
          }
        }
      }
    }
    return res;
  }

  private async buildDeepLink(customMeta: Record<string, any>) {
    const base64Enc = encodeURIComponent(customMeta.encodedQuery);
    const workspaceId = customMeta.workspace;
    const subscription = customMeta.subscription;

    const details = await this.getWorkspaceDetails(workspaceId);
    if (!details.workspace || !details.resourceGroup) {
      return '';
    }

    const url =
      `https://portal.azure.com/#blade/Microsoft_OperationsManagementSuite_Workspace/` +
      `AnalyticsBlade/initiator/AnalyticsShareLinkToQuery/isQueryEditorVisible/true/scope/` +
      `%7B%22resources%22%3A%5B%7B%22resourceId%22%3A%22%2Fsubscriptions%2F${subscription}` +
      `%2Fresourcegroups%2F${details.resourceGroup}%2Fproviders%2Fmicrosoft.operationalinsights%2Fworkspaces%2F${details.workspace}` +
      `%22%7D%5D%7D/query/${base64Enc}/isQueryBase64Compressed/true/timespanInIsoFormat/P1D`;
    return url;
  }

  async getWorkspaceDetails(workspaceId: string) {
    const response = await this.getWorkspaceList(this.subscriptionId);

    const details = response.data.value.find((o: any) => {
      return o.properties.customerId === workspaceId;
    });

    if (!details) {
      return {};
    }

    const regex = /.*resourcegroups\/(.*)\/providers.*/;
    const results = regex.exec(details.id);
    if (!results || results.length < 2) {
      return {};
    }

    return {
      workspace: details.name,
      resourceGroup: results[1],
    };
  }

  /**
   * This is named differently than DataSourceApi.metricFindQuery
   * because it's not exposed to Grafana like the main AzureMonitorDataSource.
   * And some of the azure internal data sources return null in this function, which the
   * external interface does not support
   */
  metricFindQueryInternal(query: string): Promise<MetricFindValue[]> {
    const resourcesQuery = query.match(/^resources\(\)/i);
    if (resourcesQuery) {
      return this.getResources(this.subscriptionId);
    }

    const resourcesQueryWithSub = query.match(/^resources\(["']?([^\)]+?)["']?\)/i);
    if (resourcesQueryWithSub) {
      return this.getResources((resourcesQueryWithSub[1] || '').trim());
    }

    return this.getDefaultOrFirstResource().then((resource: any) => {
      const queries: any[] = this.buildQuery(query, null, resource);

      const promises = this.doQueries(queries);

      return Promise.all(promises)
        .then((results) => {
          return new ResponseParser(results).parseToVariables();
        })
        .catch((err) => {
          if (
            err.error &&
            err.error.data &&
            err.error.data.error &&
            err.error.data.error.innererror &&
            err.error.data.error.innererror.innererror
          ) {
            throw { message: err.error.data.error.innererror.innererror.message };
          } else if (err.error && err.error.data && err.error.data.error) {
            throw { message: err.error.data.error.message };
          }
        });
    }) as Promise<MetricFindValue[]>;
  }

  private buildQuery(query: string, options: any, workspace: any) {
    const querystringBuilder = new LogAnalyticsQuerystringBuilder(
      getTemplateSrv().replace(query, {}, this.interpolateVariable),
      options,
      'TimeGenerated'
    );
    const querystring = querystringBuilder.generate().uriString;
    const url = `${this.baseUrl}/${workspace}/query?${querystring}`;
    const queries: any[] = [];
    queries.push({
      datasourceId: this.id,
      url: url,
      resultFormat: 'table',
    });
    return queries;
  }

  interpolateVariable(value: string, variable: { multi: any; includeAll: any }) {
    if (typeof value === 'string') {
      if (variable.multi || variable.includeAll) {
        return "'" + value + "'";
      } else {
        return value;
      }
    }

    if (typeof value === 'number') {
      return value;
    }

    const quotedValues = _.map(value, (val) => {
      if (typeof value === 'number') {
        return value;
      }

      return "'" + val + "'";
    });
    return quotedValues.join(',');
  }

  getDefaultOrFirstResource() {
    if (this.defaultOrFirstResource) {
      return Promise.resolve(this.defaultOrFirstResource);
    }

    return this.getResources(this.subscriptionId).then((resources: any[]) => {
      this.defaultOrFirstResource = resources[0].value;
      return this.defaultOrFirstResource;
    });
  }

  annotationQuery(options: any) {
    if (!options.annotation.rawQuery) {
      return Promise.reject({
        message: 'Query missing in annotation definition',
      });
    }

    const queries: any[] = this.buildQuery(options.annotation.rawQuery, options, options.annotation.workspace);

    const promises = this.doQueries(queries);

    return Promise.all(promises).then((results) => {
      const annotations = new ResponseParser(results).transformToAnnotations(options);
      return annotations;
    });
  }

  doQueries(queries: any[]) {
    return _.map(queries, (query) => {
      return this.doRequest(query.url)
        .then((result: any) => {
          return {
            result: result,
            query: query,
          };
        })
        .catch((err: any) => {
          throw {
            error: err,
            query: query,
          };
        });
    });
  }

  async doRequest(url: string, method = 'GET', data?: any, useCache = false, maxRetries = 1): Promise<any> {
    try {
      if (useCache && this.cache.has(url)) {
        return this.cache.get(url);
      }

      const res = await getBackendSrv().datasourceRequest({
        url: this.url + url,
        method,
        data,
      });

      if (useCache) {
        this.cache.set(url, res);
      }

      return res;
    } catch (error) {
      if (maxRetries > 0) {
        return this.doRequest(url, method, data, useCache, maxRetries - 1);
      }

      throw error;
    }
  }

  testDatasource(): Promise<any> {
    const validationError = this.isValidConfig();
    if (validationError) {
      return Promise.resolve(validationError);
    }

    return this.getDefaultOrFirstResource()
      .then((rs: any) => {
        const url = `${this.baseUrl}${rs}/metadata`;

        return this.doRequest(url, 'POST');
      })
      .then((response: any) => {
        if (response.status === 200) {
          return {
            status: 'success',
            message: 'Successfully queried the Azure Resource Log Analytics service.',
            title: 'Success',
          };
        }

        return {
          status: 'error',
          message: 'Returned http status code ' + response.status,
        };
      })
      .catch((error: any) => {
        let message = 'Azure Resource Log Analytics: ';
        if (error.config && error.config.url && error.config.url.indexOf('resourcesloganalytics') > -1) {
          message = 'Azure Log Analytics requires access to Azure Monitor but had the following error: ';
        }

        message = this.getErrorMessage(message, error);

        return {
          status: 'error',
          message: message,
        };
      });
  }

  private getErrorMessage(message: string, error: any) {
    message += error.statusText ? error.statusText + ': ' : '';
    if (error.data && error.data.error && error.data.error.code) {
      message += error.data.error.code + '. ' + error.data.error.message;
    } else if (error.data && error.data.error) {
      message += error.data.error;
    } else if (error.data) {
      message += error.data;
    } else {
      message += 'Cannot connect to Azure Log Analytics REST API.';
    }
    return message;
  }

  isValidConfig() {
    if (this.instanceSettings.jsonData.azureResourceLogAnalyticsSameAs) {
      return undefined;
    }

    if (!this.isValidConfigField(this.instanceSettings.jsonData.logAnalyticsSubscriptionId)) {
      return {
        status: 'error',
        message: 'The Subscription Id field is required.',
      };
    }

    if (!this.isValidConfigField(this.instanceSettings.jsonData.logAnalyticsTenantId)) {
      return {
        status: 'error',
        message: 'The Tenant Id field is required.',
      };
    }

    if (!this.isValidConfigField(this.instanceSettings.jsonData.logAnalyticsClientId)) {
      return {
        status: 'error',
        message: 'The Client Id field is required.',
      };
    }

    return undefined;
  }

  isValidConfigField(field: string | undefined) {
    return field && field.length > 0;
  }
}
