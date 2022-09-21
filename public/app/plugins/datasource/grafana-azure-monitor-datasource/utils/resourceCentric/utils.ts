import { StringMap } from '../sharedInterfaces';

import * as RCKQLTableDataMap from './RCKQLTableDataMap';

export const KQLTables: StringMap<string> = {
  Requests: 'requests',
  Dependencies: 'dependencies',
  Exceptions: 'exceptions',
  CustomEvents: 'customEvents',
  Traces: 'traces',
  Availability: 'availabilityResults',
  PageViews: 'pageViews',
  CustomMetrics: 'customMetrics',
  PerformanceCounters: 'performanceCounters',
  BrowserTimings: 'browserTimings',
};

function convertRCTableToKQL(KQLTable: string): string {
  let KQLNameConvertorStrings: string[] = [];
  let KQLDataMap: StringMap<string>;
  switch (KQLTable) {
    case KQLTables.Requests:
      KQLDataMap = RCKQLTableDataMap.KQLRequestDataMap;
      break;
    case KQLTables.Dependencies:
      KQLDataMap = RCKQLTableDataMap.KQLDependencyData;
      break;
    case KQLTables.Exceptions:
      KQLDataMap = RCKQLTableDataMap.KQLExceptionData;
      break;
    case KQLTables.Traces:
      KQLDataMap = RCKQLTableDataMap.KQLTraceData;
      break;
    case KQLTables.CustomEvents:
      KQLDataMap = RCKQLTableDataMap.KQLCustomEventData;
      break;
    case KQLTables.Availability:
      KQLDataMap = RCKQLTableDataMap.KQLAvailabilityData;
      break;
    case KQLTables.PageViews:
      KQLDataMap = RCKQLTableDataMap.KQLPageViewData;
      break;
    case KQLTables.CustomMetrics:
      KQLDataMap = RCKQLTableDataMap.KQLCustomMetricData;
      break;
    case KQLTables.PerformanceCounters:
      KQLDataMap = RCKQLTableDataMap.KQLPerformanceCounterData;
      break;
    case KQLTables.BrowserTimings:
      KQLDataMap = RCKQLTableDataMap.KQLBrowserTimingsData;
      break;
    default:
      KQLDataMap = {};
      break;
  }

  for (const prop in KQLDataMap) {
    if (!KQLDataMap.hasOwnProperty(prop)) {
      continue;
    }
    KQLNameConvertorStrings.push(`${prop}=${KQLDataMap[prop]}`);
  }

  if (KQLNameConvertorStrings.length === 0) {
    return '';
  }
  return `let ${KQLTable} = ${RCKQLTableDataMap.RCKQLTablesMap[KQLTable]}
  | project ${KQLNameConvertorStrings.join()};`;
}

export function addConvertedRCKQLTables(query: string | undefined): string {
  if (!query) {
    return '';
  }
  let convertedTables = '';
  for (const KQLTable in KQLTables) {
    if (!KQLTables.hasOwnProperty(KQLTable)) {
      continue;
    }
    convertedTables += convertRCTableToKQL(KQLTables[KQLTable]);
  }

  return convertedTables + query;
}

const ComponentsResourceType = 'microsoft.insights/components';
export function isGenericResourceId(id: string | undefined): boolean {
  if (!id) {
    return false;
  }

  return id.toLowerCase().indexOf(ComponentsResourceType) < 0;
}
