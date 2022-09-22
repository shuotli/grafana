import { StringMap } from '../sharedInterfaces';

/**
 * Property name map between AppInsights resource table and Resource-Centric resource table
 */

export const RCKQLTablesMap: StringMap<string> = {
  requests: 'AppRequests',
  dependencies: 'AppDependencies',
  exceptions: 'AppExceptions',
  customEvents: 'AppEvents',
  customMetrics: 'AppMetrics',
  traces: 'AppTraces',
  availabilityResults: 'AppAvailabilityResults',
  pageViews: 'AppPageViews',
  performanceCounters: 'AppPerformanceCounters',
  browserTimings: 'AppBrowserTimings',
};

export const RCKQLBaseDataMap: StringMap<string> = {
  timestamp: 'TimeGenerated',
  customDimensions: 'Properties',
  operation_Name: 'iff(isempty(OperationName), column_ifexists("Name", ""), OperationName)',
  operation_Id: 'OperationId',
  operation_ParentId: 'ParentId',
  operation_SyntheticSource: 'SyntheticSource',
  session_Id: 'SessionId',
  user_Id: 'UserId',
  user_AuthenticatedId: 'UserAuthenticatedId',
  user_AccountId: 'UserAccountId',
  application_Version: 'AppVersion',
  cloud_RoleName: 'AppRoleName',
  cloud_RoleInstance: 'AppRoleInstance',
  client_Type: 'ClientType',
  client_Model: 'ClientModel',
  client_OS: 'ClientOS',
  client_IP: 'ClientIP',
  client_City: 'ClientCity',
  client_StateOrProvince: 'ClientStateOrProvince',
  client_CountryOrRegion: 'ClientCountryOrRegion',
  client_Browser: 'ClientBrowser',
  iKey: 'IKey',
  sdkVersion: 'SDKVersion',
  appId: '_ResourceId',
  itemId: '_ItemId',
  _ResourceId: '_ResourceId',
};

export const RCKQLCommonDataMap: StringMap<string> = {
  customMeasurements: 'Measurements',
  itemCount: 'iff(isempty(ItemCount), 1, ItemCount)',
};

export const KQLRequestDataMap: StringMap<string> = {
  ...RCKQLBaseDataMap,
  ...RCKQLCommonDataMap,
  itemType: '"request"',
  id: 'Id',
  resultCode: 'ResultCode',
  success: 'tostring(Success)',
  duration: 'DurationMs',
  source: 'Source',
  url: 'Url',
  name: 'Name',
  performanceBucket: `iff(isempty(PerformanceBucket), case(
    DurationMs < 250, "<250ms",
    DurationMs < 500, "250ms-500ms",
    DurationMs < 1000, "500ms-1sec",
    DurationMs < 3000, "1sec-3sec",
    DurationMs < 7000, "3sec-7sec",
    DurationMs < 15000, "7sec-15sec",
    DurationMs < 30000, "15sec-30sec",
    DurationMs < 60000, "30sec-1min",
    DurationMs < 120000, "1min-2min",
    DurationMs < 300000, "2min-5min",
    ">=5min"), PerformanceBucket)`,
};

export const KQLDependencyData: StringMap<string> = {
  ...RCKQLBaseDataMap,
  ...RCKQLCommonDataMap,
  itemType: '"dependency"',
  id: 'Id',
  target: 'Target',
  type: 'DependencyType',
  resultCode: 'ResultCode',
  success: 'tostring(Success)',
  duration: 'DurationMs',
  name: 'Name',
  data: 'Data',
  performanceBucket: `iff(isempty(PerformanceBucket), case(
    DurationMs < 250, "<250ms",
    DurationMs < 500, "250ms-500ms",
    DurationMs < 1000, "500ms-1sec",
    DurationMs < 3000, "1sec-3sec",
    DurationMs < 7000, "3sec-7sec",
    DurationMs < 15000, "7sec-15sec",
    DurationMs < 30000, "15sec-30sec",
    DurationMs < 60000, "30sec-1min",
    DurationMs < 120000, "1min-2min",
    DurationMs < 300000, "2min-5min",
    ">=5min"), PerformanceBucket)`,
};

export const KQLExceptionData: StringMap<string> = {
  ...RCKQLBaseDataMap,
  ...RCKQLCommonDataMap,
  itemType: '"exception"',
  problemId: 'iff(isempty(ProblemId), ExceptionType, ProblemId)',
  handledAt: 'HandledAt',
  message: 'Message',
  type: 'ExceptionType',
  assembly: 'Assembly',
  method: 'Method',
  details: 'Details',
  severityLevel: 'SeverityLevel',
  outerMessage: 'OuterMessage',
  outerAssembly: 'OuterAssembly',
  outerMethod: 'OuterMethod',
  outerType: 'OuterType',
  innermostMessage: 'InnermostMessage',
  innermostAssembly: 'InnermostAssembly',
  innermostMethod: 'InnermostMethod',
  innermostType: 'InnermostType',
};

export const KQLTraceData: StringMap<string> = {
  ...RCKQLBaseDataMap,
  ...RCKQLCommonDataMap,
  itemType: '"trace"',
  message: 'Message',
  severityLevel: 'SeverityLevel',
};

export const KQLCustomEventData: StringMap<string> = {
  ...RCKQLBaseDataMap,
  ...RCKQLCommonDataMap,
  itemType: '"customEvent"',
  name: 'Name',
};

export const KQLAvailabilityData: StringMap<string> = {
  ...RCKQLBaseDataMap,
  ...RCKQLCommonDataMap,
  itemType: '"availabilityResult"',
  name: 'Name',
  location: 'Location',
  success: 'tostring(Success)',
  message: 'Message',
  duration: 'DurationMs',
  id: 'Id',
};

export const KQLPageViewData: StringMap<string> = {
  ...RCKQLBaseDataMap,
  ...RCKQLCommonDataMap,
  itemType: '"pageView"',
  id: 'Id',
  name: 'Name',
  url: 'Url',
  duration: 'DurationMs',
  performanceBucket: 'PerformanceBucket',
};

export const KQLCustomMetricData: StringMap<string> = {
  ...RCKQLBaseDataMap,
  itemType: '"customMetric"',
  valueCount: 'iff(isempty(ItemCount), 1, ItemCount)',
  name: 'Name',
  valueSum: 'Sum',
  valueMin: 'Min',
  valueMax: 'Max',
};

export const KQLPerformanceCounterData: StringMap<string> = {
  ...RCKQLBaseDataMap,
  itemType: '"performanceCounter"',
  name: 'Name',
  category: 'Category',
  counter: 'Counter',
  instance: 'Instance',
  value: 'Value',
};

export const KQLBrowserTimingsData: StringMap<string> = {
  ...RCKQLBaseDataMap,
  ...RCKQLCommonDataMap,
  itemType: '"browserTiming"',
  name: 'Name',
  url: 'Url',
  performanceBucket: 'PerformanceBucket',
  networkDuration: 'NetworkDurationMs',
  sendDuration: 'SendDurationMs',
  receiveDuration: 'ReceiveDurationMs',
  processingDuration: 'ProcessingDurationMs',
  totalDuration: 'TotalDurationMs',
};
