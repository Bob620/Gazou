const request = require('request-promise-native');
const fs = require('fs');

const protocols = require('./wsProtocol');

const WebSocket = require('ws');
let i = 0;

function* nextUid() {
	while(true)
		yield `.Uid:${i++}`;
}

class Client {
	constructor(address, log, protocol=1) {
		this.data = {
			address,
			protocol: protocols[protocol],
			connected: false,
			requests: new Map()
		};
	}

	connect() {
		if (!this.data.connected)
			return new Promise((resolve, reject) => {
				let hasResolved = false;
				const ws = this.data.ws = new WebSocket(this.data.address.startsWith('ws://') || this.data.address.startsWith('wss://') ? this.data.address : 'ws://' + this.data.address);

				ws.on('open', () => {
					hasResolved = true;
					this.data.connected = true;
					resolve();
				});

				ws.on('message', message => {
					const {event, data, callback} = JSON.parse(message);
					const request = this.data.requests.get(callback);
					if (request)
						if (event === 'error')
							request.reject(data);
						else
							request.resolve(data);
				});

				ws.on('close', (code, reason) => {
					this.data.connected = false;
				});

				ws.on('error', err => {
					this.data.connected = false;
					console.error(err);
					if (!hasResolved)
						reject(err);
				});
			});
		return Promise.reject();
	}

	disconnect() {
		if (this.data.connected)
			this.data.ws.close();
	}

	get(uuids) {
		if (uuids && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				if (typeof uuids === 'string') {
					this.send({
						event: 'get.single',
						data: {
							uuid: uuids
						},
						callback: uid.value
					}, {resolve, reject});
				} else {
					this.send({
						event: 'get.batch',
						data: {
							uuids
						},
						callback: uid.value
					}, {resolve, reject});
				}
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	remove(uuids) {
		if (uuids && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				if (typeof uuids === 'string') {
					this.send({
						event: 'remove.single',
						data: {
							uuid: uuids
						},
						callback: uid.value
					}, {resolve, reject});
				} else {
					this.send({
						event: 'remove.batch',
						data: {
							uuids
						},
						callback: uid.value
					}, {resolve, reject});
				}
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	hasHash(hashes) {
		if (hashes && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				if (typeof hashes === 'string') {
					this.send({
						event: 'has.singleHash',
						data: {
							hash: hashes
						},
						callback: uid.value
					}, {resolve, reject});
				} else {
					this.send({
						event: 'has.batchHash',
						data: {
							hashes: hashes
						},
						callback: uid.value
					}, {resolve, reject});
				}
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	update(uuid, metadata) {
		if (uuid && this.data.connected && typeof metadata === 'object') {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				this.send({
					event: 'update',
					data: {
						uuid,
						metadata
					},
					callback: uid.value
				}, {resolve, reject});
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	searchDateModified(min, max, count, startPosition) {
		if (min && max && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				this.send({
					event: 'search.dateModified',
					data: {
						min,
						max,
						count,
						startPosition
					},
					callback: uid.value
				}, {resolve, reject});
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	searchDateAdded(min, max, count, startPosition) {
		if (min && max && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				this.send({
					event: 'search.dateAdded',
					data: {
						min,
						max,
						count,
						startPosition
					},
					callback: uid.value
				}, {resolve, reject});
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	searchArtist(name, count, startPosition) {
		if (name && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				this.send({
					event: 'search.artist',
					data: {
						name,
						count,
						startPosition
					},
					callback: uid.value
				}, {resolve, reject});
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	searchTags(tags, count, startPosition) {
		if (tags && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				this.send({
					event: 'search.tags',
					data: {
						tags,
						count,
						startPosition
					},
					callback: uid.value
				}, {resolve, reject});
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	uploadImage(uploadLink, imageLocation) {
		return request.post({
			url: uploadLink,
			formData: {
				image: fs.createReadStream(imageLocation)
			}
		});
	}

	upload(hash, type, artist, tags) {
		if (hash && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				this.send({
					event: 'upload',
					data: {
						hash,
						type,
						artist,
						tags
					},
					callback: uid.value
				}, {resolve, reject});
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	authInit(uuid) {
		if (uuid && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				this.send({
					event: 'authenticate.init',
					data: {
						id: uuid
					},
					callback: uid.value
				}, {resolve, reject});
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	authSubmit(code) {
		if (code && this.data.connected) {
			return new Promise((resolve, reject) => {
				const uid = nextUid().next();
				this.send({
					event: 'authenticate.submit',
					data: {
						token: code
					},
					callback: uid.value
				}, {resolve, reject});
			});
		}
		return Promise.reject({message: 'not connected'});
	}

	send(message, callback) {
		this.data.ws.send(JSON.stringify(message));
		this.data.requests.set(message.callback, callback);
	}
}

module.exports = Client;