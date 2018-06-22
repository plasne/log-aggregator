
// includes
import LogFile from "./LogFile";
import Configuration from "./Configuration";

export default class LogFiles extends Array<LogFile> {

    notify(path: string, config: Configuration) {
        const existing = this.find(file => file.path.toLowerCase() === path.toLowerCase());
        if (existing) {
            existing.read();
        } else {
            const logFile = new LogFile(path, config);
            this.push(logFile);
            logFile.read();
        }
    }

    delete(path: string) {
        const existing = this.find(file => file.isMatch(path));
        if (existing) {
            this.remove(existing);
            existing.halt();
            global.logger.log("verbose", `file "${path}" will no longer watched for changes.`);
        }
    }

}