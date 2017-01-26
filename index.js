'use strict'

/**
 * Bunyan Log Stream compatible with SumoLogic
 * Sends logs directly to SumoLogic via the http endpoint
 *
 * Adapted from https://github.com/helix-collective/node-sumologic
 */
var request = require('request');


function safeToString(obj) {
  try {
    return JSON.stringify(obj);
  } catch (err) {
    try {
      return JSON.stringify(String(obj));
    } catch (err2) {
      return JSON.stringify('error serializing log line');
    }
  }
}


var LEVEL_NAMES = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL'
};
function safeRewriteLevel(obj) {
  if (obj.level) {
    try {
      obj.level = LEVEL_NAMES[obj.level]; // eslint-disable-line no-param-reassign
    } catch (err) { } // eslint-disable-line
  }
}


module.exports = function SumoLogger(opts) {
  if (!opts || !opts.collector) {
    throw new Error('SumoLogic collector key must be passed');
  }

  var endpoint = opts.endpoint || 'https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/';
  var collectorEndpoint = endpoint + opts.collector;
  var syncInterval = opts.syncInterval || 1000;
  var maxLines = opts.maxLines || 100;

  var rewriteLevels = true;
  if (opts.rewriteLevels !== undefined) {
    rewriteLevels = !!opts.rewriteLevels;
  }

  // Cache of entries we are yet to sync
  var unsynced = [];

  /**
   * `write` function required on a Bunyan log stream - https://github.com/trentm/node-bunyan#stream-type-raw
   * `record` is a bunyan log record - https://github.com/trentm/node-bunyan#log-record-fields
   */
  this.write = function (record) {
    if (rewriteLevels) {
      safeRewriteLevel(record);
    }

    unsynced.push(safeToString(record));
  };


  var numBeingSent = 0;

  function syncLogsToSumo() {
    // Only one active sync at any given interval
    if (numBeingSent > 0) {
      return;
    }

    // Short-circuit if there is nothing to send
    if (unsynced.length === 0) {
      return;
    }

    var logLines = unsynced.slice(0, maxLines);
    var body = logLines.join('\n');
    numBeingSent = logLines.length;

    // Sync logs to sumo-logic, and clear all synced data. On failure we'll retry the sync
    request({
      method: 'POST',
      url: collectorEndpoint,
      body: body
    }, function (error, response) {
      var failed = !!error ||
        response.status < 200 ||
        response.status >= 400;

      if (!failed) {
        unsynced.splice(0, numBeingSent);
      }
      numBeingSent = 0;
    });
  }

  setInterval(syncLogsToSumo, syncInterval);
};