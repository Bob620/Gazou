class Log {
	constructor(logs=[]) {
		this.data = {
			logs: {},
			handles: {}
		};

		for (const log in logs)
			this.addLog(log);
	}

	addLog(log) {
		if (typeof log === 'string') {
			const dataLog = this.data.logs[log] = {
				data: {
					name: log,
					handles: {}
				}
			};

			dataLog.addHandle = this.addHandle.bind(dataLog);
		} else {
			const dataLog = this.data.logs[log.name] = {
				data: {
					name: log.name,
					handles: {}
				}
			};

			dataLog.addHandle = this.addHandle.bind(dataLog);

			for (const handle of log.handles)
				dataLog.addHandle(handle)
		}
	}

	addHandle(handleName) {
		this.data.handles[handleName] = () => {

		}
	}
}