
* metrics merge to controller needs to account for: (1) file, (2) read from disk
* summary needs to read metrics from disk

* Support state on Azure storage
* Add trim to checkpoints for files that doesn't exist any longer
* Handle files being deleted
* Handle destinations changing
* add custom metrics
* change the errors to go to a Log Analytics environment

* add a flag for whether the file writes are assumed at the end of a record (ie. no extra)
* test all "bad" configurations and make sure there are error messages
* need to test that all rows are committed (none skipped)

* Need to compile Node into an executable
