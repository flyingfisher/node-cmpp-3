///<reference path='typings/node/node.d.ts' />

var config = {
	heartbeatInterval: 3 * 60 * 1000,
	heartbeatTimeout: 60 * 1000,
	heartbeatMaxAttempts: 3,
	timeout:30*1000,
	port:7890,
	host:"127.0.0.1",
	serviceId:"serviceName",
	feeCode:"100",
	srcId:"10xxxxxx"
};

export = config;