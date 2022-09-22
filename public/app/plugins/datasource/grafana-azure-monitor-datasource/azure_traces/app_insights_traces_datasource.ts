/* eslint-disable*/
// TODO: remove lint disable rule
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  MutableDataFrame,
  Field,
  TraceKeyValuePair,
  Vector,
} from '@grafana/data';

import AzureLogAnalyticsDatasource from '../azure_log_analytics/azure_log_analytics_datasource';
import { AzureDataSourceJsonData, AzureMonitorQuery } from '../types';

export default class AzureTracesDatasource extends AzureLogAnalyticsDatasource {
  operationId: string;
  constructor(instanceSettings: DataSourceInstanceSettings<AzureDataSourceJsonData>) {
    super(instanceSettings);
    this.operationId = '';
  }

  query(request: DataQueryRequest<AzureMonitorQuery>): Observable<DataQueryResponse> {
    this.operationId = request.targets[0].azureLogAnalytics?.operationId ?? '';
    // only take the first query
    const target = this.buildTraceQuery(request.targets[0]);

    const req = { ...request, targets: [target] };
    return super.query(req).pipe(
      map((res: DataQueryResponse) => {
        const newDf = this.convertResponseToTrace(res);
        return newDf;
      })
    );
  }
  buildTraceQuery(target: AzureMonitorQuery): AzureMonitorQuery {
    if (!target.azureLogAnalytics || !this.operationId || this.operationId === '') {
      return { ...target };
    }
    const queryString = `set truncationmaxrecords=10000;
    set truncationmaxsize=67108864;
    union isfuzzy=true AppEvents,AppPageViews,AppRequests,AppDependencies,AppExceptions,AppAvailabilityResults
    | where TimeGenerated > $__timeFrom and TimeGenerated < $__timeTo
    | where (OperationId != '' and OperationId == '${this.operationId}') or (Properties.ai_legacyRootId != '' and Properties.ai_legacyRootId == '${this.operationId}')
    | extend duration = toreal(column_ifexists("DurationMs", 0)), Id = column_ifexists("Id", ""), serviceName = column_ifexists("Name", column_ifexists("ProblemId", ""))
    | extend duration = iff(isnull(duration), toreal(0), duration)
    | extend spanID = iff(isempty(Id), tostring(new_guid()), Id)
    | project OperationId, ParentId, spanID, duration, TimeGenerated, serviceName, Properties
    | project-rename traceID = OperationId, parentSpanID = ParentId, startTime = TimeGenerated, serviceTags = Properties`;

    return {
      ...target,
      azureLogAnalytics: {
        ...target.azureLogAnalytics,
        query: queryString,
        resultFormat: 'table',
      },
    };
  }

  convertResponseToTrace(res: DataQueryResponse): DataQueryResponse {
    const fields: Field[] = res.data[0]?.fields ?? [];
    const serviceTags =
      fields.filter((field: Field) => {
        return field.name === 'serviceTags';
      }) ?? [];
    const transformedST = this.convertServiceTags(serviceTags);
    const newFields: Field[] = fields.map((field) => {
      if (field.name === 'serviceTags') {
        field.values = transformedST;
      }
      return field;
    });
    if (res.data) {
      const data = [
        new MutableDataFrame({
          fields: newFields,
          meta: {
            preferredVisualisationType: 'trace',
          },
        }),
      ];
      res.data = data;
    }
    return res;
  }

  convertServiceTags(serviceTags: Field[]) {
    const stValues = serviceTags[0]?.values;
    if (!stValues) {
      return [] as unknown as Vector<TraceKeyValuePair[]>;
    }
    const newVals = [];
    for (const stValue of stValues.toArray()) {
      const jsonObj = JSON.parse(stValue);
      const traceValKeys = [];
      for (const i in jsonObj) {
        const traceValKey = {
          key: i,
          value: jsonObj[i],
        };
        traceValKeys.push(traceValKey);
      }
      newVals.push(traceValKeys);
    }

    return newVals as unknown as Vector<TraceKeyValuePair[]>;
  }
}
