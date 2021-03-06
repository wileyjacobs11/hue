// Licensed to Cloudera, Inc. under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  Cloudera, Inc. licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as ko from 'knockout';

import apiHelper from 'api/apiHelper';
import huePubSub from 'utils/huePubSub';
import { sleep } from 'utils/hueUtils';
import { EXECUTION_STATUS } from './executable';

export const RESULT_UPDATED_EVENT = 'hue.executable.result.updated';

export const RESULT_TYPE = {
  TABLE: 'table'
};

const META_TYPE_TO_CSS = {
  bigint: 'sort-numeric',
  date: 'sort-date',
  datetime: 'sort-date',
  decimal: 'sort-numeric',
  double: 'sort-numeric',
  float: 'sort-numeric',
  int: 'sort-numeric',
  real: 'sort-numeric',
  smallint: 'sort-numeric',
  timestamp: 'sort-date',
  tinyint: 'sort-numeric'
};

const NUMERIC_TYPES = {
  bigint: true,
  decimal: true,
  double: true,
  float: true,
  int: true,
  real: true,
  smallint: true,
  tinyint: true
};

const DATE_TIME_TYPES = {
  date: true,
  datetime: true,
  timestamp: true
};

const COMPLEX_TYPES = {
  array: true,
  map: true,
  struct: true
};

huePubSub.subscribe('editor.ws.query.fetch_result', executionResult => {
  if (executionResult.status != 'finalMessage') {
    const result = new ExecutionResult(null);
    result.fetchedOnce = true;
    result.handleResultResponse(executionResult);
    // eslint-disable-next-line no-undef
    executionResult.data.forEach(element => $('#wsResult').append('<li>' + element + '</li>'));
  }
});

export default class ExecutionResult {
  /**
   *
   * @param {Executable} executable
   */
  constructor(executable) {
    this.executable = executable;

    this.type = RESULT_TYPE.TABLE;
    this.rows = [];
    this.meta = [];

    this.cleanedMeta = [];
    this.cleanedDateTimeMeta = [];
    this.cleanedStringMeta = [];
    this.cleanedNumericMeta = [];
    this.koEnrichedMeta = [];

    this.lastRows = [];
    this.images = [];
    this.type = undefined;
    this.hasMore = true;
    this.isEscaped = false;
    this.fetchedOnce = false;
  }

  async fetchResultSize() {
    if (this.executable.status === EXECUTION_STATUS.failed) {
      return;
    }

    let attempts = 0;
    const waitForRows = async () => {
      attempts++;
      if (attempts < 10) {
        const resultSizeResponse = await apiHelper.fetchResultSize2({
          executable: this.executable,
          silenceErrors: true
        });

        if (resultSizeResponse.rows !== null) {
          return resultSizeResponse;
        } else {
          await sleep(1000);
          return await waitForRows();
        }
      } else {
        return Promise.reject();
      }
    };

    return await waitForRows();
  }

  /**
   * Fetches additional rows
   *
   * @param {Object} [options]
   * @param {number} [options.rows]
   * @param {boolean} [options.startOver]
   *
   * @return {Promise}
   */
  async fetchRows(options) {
    const resultResponse = await apiHelper.fetchResults({
      executable: this.executable,
      rows: (options && options.rows) || 100,
      startOver: options && options.startOver
    });

    this.handleResultResponse(resultResponse);
  }

  handleResultResponse(resultResponse) {
    const initialIndex = this.rows.length;
    resultResponse.data.forEach((row, index) => {
      row.unshift(initialIndex + index + 1);
    });

    this.rows.push(...resultResponse.data);
    this.lastRows = resultResponse.data;
    if (!this.meta.length) {
      this.meta = resultResponse.meta;
      this.meta.unshift({ type: 'INT_TYPE', name: '', comment: null });

      this.meta.forEach((item, index) => {
        const cleanedType = item.type.replace(/_type/i, '').toLowerCase();
        if (index) {
          this.cleanedMeta.push(item);
          if (NUMERIC_TYPES[cleanedType]) {
            this.cleanedNumericMeta.push(item);
          } else if (DATE_TIME_TYPES[cleanedType]) {
            this.cleanedDateTimeMeta.push(item);
          } else if (!COMPLEX_TYPES[cleanedType]) {
            this.cleanedStringMeta.push(item);
          }
        }
        this.koEnrichedMeta.push({
          name: item.name,
          type: cleanedType,
          comment: item.comment,
          cssClass: META_TYPE_TO_CSS[cleanedType] || 'sort-string',
          checked: ko.observable(true),
          originalIndex: index
        });
      });
    }
    this.hasMore = resultResponse.has_more;
    this.isEscaped = resultResponse.isEscaped;
    if (resultResponse.type) {
      this.type = resultResponse.type;
    }
    this.fetchedOnce = true;
    this.notify();
  }

  notify() {
    huePubSub.publish(RESULT_UPDATED_EVENT, this);
  }
}
