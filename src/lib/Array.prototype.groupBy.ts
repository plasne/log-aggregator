
if (!Array.prototype.groupBy) {
    Array.prototype.groupBy = function <T>(key: resolveToKey<T>): grouping<T>[] {
        return this.reduce((rv: grouping<T>[], x: T) => {
            const _key = key instanceof Function ? key(x) : (x as any)[key];
            if (_key) {
                const match = rv.find(r => r.key === _key);
                if (match) {
                    match.values.push(x);
                } else {
                    rv.push({
                        key: _key,
                        values: [x]
                    });
                }
            }
            return rv;
        }, [] as grouping<T>[]);
    };
}
