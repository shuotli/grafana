import React, { PureComponent, ChangeEvent } from 'react';
import { SelectableValue, QueryEditorProps } from '@grafana/data';
import { InlineField, Select } from '@grafana/ui';
import { ExpressionDatasourceApi } from './ExpressionDatasource';
import { Resample } from './components/Resample';
import { Reduce } from './components/Reduce';
import { Math } from './components/Math';
import { ExpressionQuery, ExpressionQueryType, gelTypes } from './types';
import { getDefaults } from './utils/expressionTypes';
import { ClassicConditions } from './components/ClassicConditions';

type Props = QueryEditorProps<ExpressionDatasourceApi, ExpressionQuery>;

const labelWidth = 14;
export class ExpressionQueryEditor extends PureComponent<Props> {
  onSelectExpressionType = (item: SelectableValue<ExpressionQueryType>) => {
    const { query, onChange } = this.props;

    onChange(getDefaults({ ...query, type: item.value! }));
  };

  onExpressionChange = (evt: ChangeEvent<any>) => {
    const { query, onChange } = this.props;
    onChange({
      ...query,
      expression: evt.target.value,
    });
  };

  renderExpressionType() {
    const { onChange, query, queries } = this.props;
    const refIds = queries!.filter((q) => query.refId !== q.refId).map((q) => ({ value: q.refId, label: q.refId }));

    switch (query.type) {
      case ExpressionQueryType.math:
        return <Math onChange={onChange} query={query} labelWidth={labelWidth} />;

      case ExpressionQueryType.reduce:
        return <Reduce refIds={refIds} onChange={onChange} labelWidth={labelWidth} query={query} />;

      case ExpressionQueryType.resample:
        return <Resample query={query} labelWidth={labelWidth} onChange={onChange} refIds={refIds} />;

      case ExpressionQueryType.classic:
        return <ClassicConditions />;
    }
  }

  render() {
    const { query } = this.props;
    const selected = gelTypes.find((o) => o.value === query.type);

    return (
      <div>
        <InlineField label="Operation" labelWidth={labelWidth}>
          <Select options={gelTypes} value={selected} onChange={this.onSelectExpressionType} width={25} />
        </InlineField>
        {this.renderExpressionType()}
      </div>
    );
  }
}
