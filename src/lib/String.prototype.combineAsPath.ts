
if (!String.prototype.combineAsPath) {
    String.prototype.combineAsPath = function(...parts: string[]) {
        parts.splice(0, 0, this.valueOf());
        for (let i = 0; i < parts.length - 1; i++) {
            if (!parts[i].endsWith("/")) parts[i] += "/";
        }
        return parts.join("");
    }
}