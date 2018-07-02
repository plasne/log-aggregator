
## Tools

The following tools are included in this project and compiled in the /bin folder:

* Controller: This application manages the configuration, metrics, and checkpoints for all dispatchers. It distributes the files and accepts changes as necessary. In addition, the controller has a web endpoint that can show charts of the captured metrics and provide metric data to Prometheus.

* Dispatcher: This application asks the controller for configuration information regarding which log files to monitor, monitors them for changes, breaks the logs into rows and columns, distributes the logs to the necessary endpoints. It sends metric and checkpoint data to the controller.

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

Alternatively, you can put environment variables in a .env file in the same directory as the controller file you are executing.

### Highly-Available Controllers

Multiple instances of the controllers may be run at the same time, you simply need a shared state folder. For example, you might run controllers in Docker containers that have a volume mounted on a shared storage system for state.

You should place the controllers behind a load balancer and provide the URL of the load balancer as the CONTROLLER_URL parameter for the dispatchers.

### Configuration

Configuration files are written by an administrator and placed in the STATE_PATH folder. When a dispatcher starts up and every 1 minute (configurable) thereafter it requests all configuration files from the controller that are targeted for it. The configuration files define what the dispatcher is to watch, how it processes them, and where it dispatches them to.

{
    "enabled": true,
    "targets": [

    ],
    "destinations": [
        {
            "name": "errors",
            "connector": "url",
            "url": "http://localhost:8091",
            "workspaceId": "7544f951-a0fa-4d13-a194-3d105f1055f9",
            "workspaceKey": "uKqdfIxjEAXvv0xYZt7DkgvBuupP5pg6vajpg1akiHFJaSkoxHu2g1XB7ZXAbnR36zzwwVYr+o9GIigH93K7Sg==",
            "logType": "logagg_error",
            "and": [
                {
                    "field": "level",
                    "test": "error"
                }
            ]
        }
    ]
}

Property     | Required? | Datatype         | Notes
------------ | :-------: | :--------------: | -----
enabled | no | boolean | Defaults to "true"; set to "false" if you don't want this configuration passed down to dispatchers.
targets | no | array of strings | You can specify the names of nodes to pass this configuration to; otherwise, it will pass to any dispatcher that asks.
destinations | no | array of destinations | Destinations are the endpoints that log entries will be sent to. You almost always want at least 1 destination unless you are just reading log files for custom metrics.
destination/name | yes | string | The name of a destination will appear in the metrics and help you diagnose problems.
destination/connector | no | "URL" or "LogAnalytics" | Defaults to "URL"; this setting determines whether the logs are posted to a URL or a Log Analytics endpoint.
destination/url | * | string | If the connector is set to "URL", you must specify the URL in this property.
destination/workspaceId | * | GUID | If the connector is set to "LogAnalytics", you must specify the Workspace ID as a GUID.
destination/workspaceKey | * | string | If the connector is set to "LogAnalytics", you must specify either the primary or secondary key.
destination/logType | * | string | If the connector is set to "LogAnalytics", you must specify a name to use for the log entry type. Log Analytics will post-fix "_CL" (custom log) to the name.
destination/and | no | array of conditions | If you specify the "and" operator, all conditions must be "true" in order for the record to be sent to the destination.
destination/or | no | array of conditions | If you specify the "or" operator, any of the conditions must be "true" in order for the record to be sent to the destination.
destination/not | no | array of conditions | If you specify the "not" operation, none of the conditions can be "true" in order for the records to be sent to the destination.
condition/field | no | string | Defaults to "__raw"; __raw will attempt a match with the entire row.
condition/test | yes | regex | If you specify a condition, you must specify a regular expression. If the regular expression matches then the test will pass as "true".

### Checkpoints

Dispatchers monitor log files for changes and then send those to receivers. Once a receiver successfully acknowledges a batch, the dispatcher will checkpoint the log files. If the dispatcher is stopped for any reason, they checkpoints will help it resume where it left off. Those checkpoint files are NOT stored on the nodes though, they are sent to the controller. The controller asks as a centralized store all all checkpoint files.

Typically dispatchers only ask for checkpoints when they start up and only send checkpoint files after batch deliveries are confirmed. In addition, no more than one checkpoint file per node per second is sent. These conditions ensure that checkpoint traffic is relatively light.

The checkpoint files are stored in the STATE_PATH folder.

### Metrics

Dispatchers collect metrics on the volume of traffic and events and send those to controllers. Controllers can produce metrics on their own events and they consolidate the information from dispatchers. Metrics are automatically tallied for all sources and destinations, but custom metrics can also be defined.

When a controller receives a metric message it merges it with the metrics it already has and writes the complete set of metrics to the STATE_PATH folder. All other controllers sharing that STATE_PATH folder will read the metrics and merge them into its own. That process ensures that whichever controller answers a request for metrics they should be aligned.

Dispatchers send metrics once every minute.

#### Events

Logs that are generated by the controller that are of level "info", "warn", or "error" are eligible to be sent as events to a receiver, this requires a configuration file named "events.cfg.json". Other than the special name and purpose, the dispatch process works as normal (you could filter to just "error" level events, for instance).

