const protocols = require('./wsProtocol');

const WebSocket = require('uws');

class Client {
	constructor(address, log, protocol=1) {
		this.data = {
			address,
			protocol: protocols[protocol],
			connected: false,
//			log
		};

//		log.addHandle('open');
//		log.addHandle('closed');
//		log.addHandle('error');
	}

	connect() {
		if (!this.data.connected) {
			const ws = this.data.ws = new WebSocket(this.data.address.startsWith('ws://') ? this.data.address : 'ws://' + this.data.address);

			ws.on('open', () => {
				this.data.connected = true;
//				this.data.log('open', address);
			});

			ws.on('message', this.data.protocol.messageHandle);

			ws.on('close', (code, reason) => {
				this.data.connected = false;
//				this.data.log('closed', code, reason);
			});

			ws.on('error', err => {
				this.data.connected = false;
//				this.data.log('error', err);
			});
		}
	}

	disconnect() {
		if (this.data.connected)
			this.data.ws.close();
	}
}

module.exports = Client;