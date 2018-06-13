
// includes
import cmd = require("commander");
import express = require("express");
import * as bodyParser from "body-parser";

// startup express
const app = express();
app.use(bodyParser.json({
    limit: "50mb"
}));

// define command line parameters
cmd
    .version("0.1.0")
    .option("-p, --port <integer>", `PORT. The port to host the web services on. Defaults to "8090".`, parseInt)
    .parse(process.argv);

// globals
const port       = cmd.port       || process.env.PORT                || 8090;

// receive
app.post("/", (req, res) => {
    console.log(req.body);
    res.status(200).end();
});

// listen for web traffic
app.listen(port, () => {
    console.log("info", `Listening on port ${port}...`);
});