
// includes
import * as fs from "fs";



// create an entry
function createEntry() {
    const name1 = "plasne";
    const name2 = "write.js";
    const id = 9999;
    const msg = "A new message was written.";
    return `${(new Date()).toISOString()} ${name1} ${name2}[${id}]: ${msg}\n`;
}

// generate some entries
const entries = [];
for (let i = 0; i < 2; i++) {
    entries.push( createEntry() );
}
const data = entries.join("");

// append the file
fs.appendFile("./logs/rfc.log", data, error => {
    if (!error) {
        console.log("appended.");
    } else {
        console.error(error);
    }
});