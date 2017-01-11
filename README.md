# bunyan-sumologic
[![npm](https://img.shields.io/npm/v/bunyan-sumologic.svg)](https://www.npmjs.com/package/bunyan-sumologic) [![npm](https://img.shields.io/npm/dt/bunyan-sumologic.svg)](https://www.npmjs.com/package/bunyan-sumologic)

[SumoLogic](https://www.sumologic.com/) stream for the [Bunyan logger](https://github.com/trentm/node-bunyan)


## Usage
```javascript
const bunyan = require('bunyan');
const SumoLogger = require('bunyan-sumologic');

const sumoConfig = {
    // required config
    collector: 'YOUR SUMOLOGIC COLLECTOR ID',

    // optional config
    endpoint: 'https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/',
    syncInterval: 1000,
    rewriteLevels: true
};

var log = bunyan.createLogger({
    name: 'myapp',
    streams: [
        {
            type: 'raw',
            stream: new SumoLogger(sumoConfig);
        }
    ]
});

log.info('Hello World!');
```

## Configuration Options
|Option|Description|
|:---|:---|
| collector     | Collector ID for the HTTP collector configured in SumoLogic<br>This property is required. |
| endpoint      | SumoLogic HTTP endpoint/region for your app<br>Default: `https://endpoint1.collection.us2.sumologic.com/receiver/v1/http/` |
| syncInterval  | How often logs should be pushed to SumoLogic in milliseconds<br>Default: `1000` |
| rewriteLevels | Whether Bunyan log levels should be rewritten to be human readable.<br>Changes `30` to `INFO`, `40` to `WARN`, etc.<br>Default: `true` |

## Installation
This module assumes you already have bunyan installed
```
npm install --save bunyan-sumologic
```
