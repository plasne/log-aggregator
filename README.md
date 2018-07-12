
## Tools

The following tools are included in this project and compiled in the /bin folder:

* Controller: This application manages the configuration, metrics, and checkpoints for all dispatchers. It distributes the files and accepts changes as necessary. In addition, the controller has a web endpoint that can show charts of the captured metrics and provide metric data to Prometheus.

* Dispatcher: This application asks the controller for configuration information regarding which log files to monitor, monitors them for changes, breaks the logs into records and fields, distributes the logs to the necessary endpoints. It sends metric and checkpoint data to the controller.

* Generator: This application generates random log entries in the specific formats. This can be used for testing.

* Receiver: This application can receive log messages from a dispatcher and writes them to the screen. This is useful for debugging since Log Analytics can take a few minutes to index a log.

* Validator: This application can send messages to Log Analytics and record how long it took for them to show up after being indexed (latency).

All of these tools are written in TypeScript. They can be run by compiling to JavaScript and hosting in Node.js or by using the provided compiled versions in /bin.

## Controller

To startup a controller, you might do one of the following:

```bash
node built/controller.js
bin/controller-linux
```

You can see the full set of parameters using --help:

```bash
-V, --version              output the version number
-l, --log-level <string>   LOG_LEVEL. The minimum level to log to the console (error, warn, info, verbose, debug, silly). Defaults to "error".
-p, --port <integer>       PORT. The port to host the web services on. Defaults to "8080".
-s, --state-path <string>  STATE_PATH. The path to all files mananging current state. Defaults to "./state".
-h, --help                 output usage information
```

You will notice that all configuration options may be set by environment variable or by the command line, for instance, you might set the port any of these ways:

```bash
node built/controller.js --port 80
PORT=80 node built/controller.js
EXPORT PORT=80
```

Alternatively, you can put environment variables in a .env file in the current directory.

### Highly-Available Controllers

Multiple instances of the controllers may be run at the same time, you simply need a shared state folder. For example, you might run controllers in Docker containers that have a volume mounted on a shared storage system for state.

You should place the controllers behind a load balancer and provide the URL of the load balancer as the CONTROLLER_URL parameter for the dispatchers.

### Configuration

Configuration files are written by an administrator and placed in the STATE_PATH folder. When a dispatcher starts up and every 1 minute (configurable) thereafter it requests all configuration files from the controller that are targeted for it. The configuration files define what the dispatcher is to watch, how it processes them, and where it dispatches them to.

Property     | Required? | Datatype         | Notes
------------ | :-------: | :--------------: | -----
enabled | no | boolean | Defaults to "true"; set to "false" if you don't want this configuration passed down to dispatchers.
targets | no | array of strings | You can specify the names of nodes to pass this configuration to; otherwise, it will pass to any dispatcher that asks.
sources | no | array of strings | You may specify a list of paths to folders or files that will be monitored for changes. You almost always want at least one source unless this is the events.cfg.json file (which should typically have none).
breaker | no | "blank-line", "every-line", "expression" | Defaults to "every-line"; this setting determines the record breaker that will be used.
expression | * | regex | If breaker is set to "expression", this property should contain the regular expression that when tested "true" indicates that a new record should be started.
fields | no | regex | This regular expression will be matched against the record to break the record into fields. Regular expression groups will be used to determine the field names.
destinations | no | array of destinations | Destinations are the endpoints that log entries will be sent to. You almost always want at least 1 destination unless you are just reading log files for custom metrics.
destination/name | yes | string | The name of a destination will appear in the metrics and help you diagnose problems.
destination/connector | no | "URL" or "LogAnalytics" | Defaults to "URL"; this setting determines whether the logs are posted to a URL or a Log Analytics endpoint.
destination/url | * | string | If the connector is set to "URL", you must specify the URL in this property.
destination/workspaceId | * | GUID | If the connector is set to "LogAnalytics", you must specify the Workspace ID as a GUID.
destination/workspaceKey | * | string | If the connector is set to "LogAnalytics", you must specify either the primary or secondary key.
destination/logType | * | string | If the connector is set to "LogAnalytics", you must specify a name to use for the log entry type. Log Analytics will post-fix "_CL" (custom log) to the name.
destination/and | no | array of conditions | If you specify the "and" operator, all conditions must be "true" in order for the record to be sent to the destination.
destination/or | no | array of conditions | If you specify the "or" operator, any of the conditions must be "true" in order for the record to be sent to the destination.
destination/not | no | array of conditions | If you specify the "not" operation, none of the conditions can be "true" in order for the record to be sent to the destination.
condition/field | no | string | Defaults to "__raw"; __raw will attempt a match with the entire record.
condition/test | yes | regex | If you specify a condition, you must specify a regular expression. If the regular expression matches then the test will pass as "true".
metrics | no | array of metrics | This section will allow you to define custom metrics.
metric/name | yes | string | The name of the metric will be shown in reports.
metric/and | no | array of conditions | If you specify the "and" operator, all conditions must be "true" in order for the metric tally to be incremented by one.
metric/or | no | array of conditions | If you specify the "or" operator, any of the conditions must be "true" in order for the metric tally to be incremented by one.
metric/not | no | array of conditions | If you specify the "not" operation, none of the conditions can be "true" in order for the metric tally to be incremented by one.

Sample configuration are provided in this project under the "/state" folder.

### Checkpoints

Dispatchers monitor log files for changes and then send those to receivers. Once a receiver successfully acknowledges a batch, the dispatcher will checkpoint the log files. If the dispatcher is stopped for any reason, they checkpoints will help it resume where it left off. Those checkpoint files are NOT stored on the nodes though, they are sent to the controller. The controller asks as a centralized store all all checkpoint files.

Typically dispatchers only ask for checkpoints when they start up and only send checkpoint files after batch deliveries are confirmed. In addition, no more than one checkpoint file per node per second is sent. These conditions ensure that checkpoint traffic is relatively light.

The checkpoint files are stored in the STATE_PATH folder.

### Metrics

Dispatchers collect metrics on the volume of traffic and events and send those to controllers. Controllers can produce metrics on their own events and they consolidate the information from dispatchers. Metrics are automatically tallied for all sources and destinations, but custom metrics can also be defined.

When a controller receives a metric message it merges it with the metrics it already has and writes the complete set of metrics to the STATE_PATH folder. All other controllers sharing that STATE_PATH folder will read the metrics and merge them into its own. That process ensures that whichever controller answers a request for metrics they should be aligned.

Dispatchers send metrics once every minute.

### Events

Logs that are generated by the controller that are of level "info", "warn", or "error" are eligible to be sent as events to a receiver, this requires a configuration file named "events.cfg.json". Other than the special name and purpose, the dispatch process works as normal (you could filter to just "error" level events, for instance).

## Dispatcher

To startup a dispatcher, you might do one of the following:

```bash
node built/dispatcher.js --url http://controller:port
bin/dispatcher-linux --url http://controller:port
```

You can see the full set of parameters using --help:

```bash
-V, --version                        output the version number
-l, --log-level <string>             LOG_LEVEL. The minimum level to log to the console (error, warn, info, verbose, debug, silly). Defaults to "error".
-n, --node-name <string>             DISPATCHER_NAME. The *unique* name that will be recorded for this dispatcher. Defaults to the system's hostname.
-u, --url <string>                   [REQUIRED] CONTROLLER_URL. The URL of the controller(s).
-i, --controller-interval <integer>  CONTROLLER_INTERVAL. The number of milliseconds between each call to the controller to get configuration changes. Defaults to "60000" (1 minute).
-c, --chunk-size <integer>           CHUNK_SIZE. The max number of KBs that are read from a log file at a time. Higher levels mean more is kept in memory. Defaults to "5000" (5 MB).
-b, --batch-size <integer>           BATCH_SIZE. The application will wait on the batch size or an interval (DISPATCH_INTERVAL) before sending records. Defaults to "100".
-d, --dispatch-interval <integer>    DISPATCH_INTERVAL. The number of milliseconds until records are dispatched even if they don't meet the batch size. Defaults to "10000" (10 seconds).
-h, --help                           output usage information
```

You will notice that all configuration options may be set by environment variable or by the command line, for instance, you might set the controller URL any of these ways:

```bash
node built/dispatcher.js --url http://controller:8080
CONTROLLER_URL=http://controller:8080 node built/dispatcher.js
EXPORT CONTROLLER_URL=http://controller:8080
```

Alternatively, you can put environment variables in a .env file in the current directory.

### Initialization

When the dispatcher starts up it:

1. Contacts the controller and asks for any checkpoints based on it's DISPATCHER_NAME.
2. Contacts the controller and asks for any configurations based on it's DISPATCHER_NAME.

The dispatcher will immediately start watching the files identified in the configuration files it received. Even if there are no new writes, if a file matching the pattern is found, it will immediately be read from the last checkpoint (in case anything was written when the dispatcher wasn't listening).

### Chunk Size

Whenever data is read from a log file, it is read in the CHUNK_SIZE. No more than 1 chunk will be held in memory for any given file, so it is important that the CHUNK_SIZE be greater than the maximum record size or else the file will be forever "stuck" - unable to read a record and dispatch it.

After a chunk of data is read, it is sent to the appropriate record breaker (as defined in the configuration file).

### Record Breaker

The record breaker takes a chunk of data and carves it up into records. The following record breakers are supported:

* every-line: [DEFAULT] Every line in the file that contains at least one non-whitespace character is considered a record.

* blank-line: Once a blank line is found, if there are any non-whitespace characters above that line (but below the previous record and all preceeding blank lines), everything above the blank line (but below the previous record and all preceeding blank lines) is considered part of the record. If a write to the file does not end in a blank line, the record will not be closed until more write activity happens in the file and a blank line is found.

* expression: Every line is tested until a line matches the expression, which is considered the start of a record. The record will be closed when a new line is found that matches the expression or when an empty line is found. Typically this empty line is the end of the file, meaning the previous line ended with a newline character and then the file was closed.

After a record is qualified, it is sent to the field breaker.

### Field Breaker

The field breaker takes a raw record and breaks it up into fields by matching groups in a regular expression.

Consider the following row...

```
2018-05-29 15:59:50,842  INFO [Server:TCP:2C:1154] com.server.impl.selector - Server:TCP:2C:1154: Connection accepted, Server: /1.1.1.1:1154 Client: /1.1.1.1:77781 keepAlive: true receiveBufferSize: 177408 sendBufferSize: 104588 reuseAddress: false tcpNoDelay: true soTimeout: 0
```

...to be processed by the following regular expression...

```regex
^(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2}) (?<hour>\\d{2}):(?<minute>\\d{2}):(?<second>\\d{2}),(?<ms>\\d{3})\\s+(?<level>\\S+)\\s\\[(?<service>.*)\\]\\s(?<namespace>\\S+)\\s-\\s(?<msg>[\\S\\s]*)$
```

...which will result in...

Field | Value
----- | -----
year | 2018
month | 05
day | 29
hour | 15
minute | 59
second | 50
ms | 842
level | INFO
service | Server:TCP:2C:1154
namespace | com.server.impl.selector
msg | Server:TCP:2C:1154: Connection accepted, Server: /1.1.1.1:1154 Client: /1.1.1.1:77781 keepAlive: true receiveBufferSize: 177408 sendBufferSize: 104588 reuseAddress: false tcpNoDelay: true soTimeout: 0

Note that this application is written in JavaScript so the regular expression parser will support the JavaScript syntax.

Note also that the regular expression in the configuration file must be escaped, so \d{4} becomes \\d{4}.

Log files could contain timestamps in many different formats but the destination will need the timestamp in a particular format. For that reason, you must break apart each component of the timestamp into fields for "year", "month", "day", "hour", "minute", "second", and "ms"; at least as far as you have (for instance, if the format doesn't include seconds or milliseconds then leave those out).

In addition to the fields you break apart, there are some addition fields that are added for your use in conditions. These are NOT sent in the payload to the destination.

Field | Value
----- | -----
__raw | The text of the whole record before it has been broken into fields.
__file | The filename of the log file this record was read from.

After a record is split into fields, it is offered to all destinations and metrics.

### Destinations

When records are offered to a destination, they are accepted or not based on the conditions defined for the destination. There are 3 comparison types:

* and - All conditions must be "true" in order for the record to be accepted.
* or - Any of the conditions must be "true" in order for the record to be accepted.
* not - None of the conditions can be "true" in order for the record to be accepted.

The comparison is evaluated by testing regular expressions against fields in the record. For instance, we might want a destination to only accept WARN or ERROR level messsages, thereby ignoring the previous record example:

```json
{
    "name": "important",
    "url": "http://important",
    "and": [
        {
            "field": "level",
            "test": "(WARN|ERROR)"
        }
    ]
}
```

There are more examples in the /state folder.

### Metrics

Metrics are automatically collected for the volume and errors in each file. However, if you wish to collect additional metrics, you can define a name (other than the reserved "volume" and "errors" names) and specify some conditions (same as destinations). All metrics are simple tallies.

For example, if you wanted to count all records that contained the word "reboot":

```json
{
    "name": "reboots",
    "and": [
        {
            "field": "__raw",
            "test": "(reboot)"
        }
    ]
}
```