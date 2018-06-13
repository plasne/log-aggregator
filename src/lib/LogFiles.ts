
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

}