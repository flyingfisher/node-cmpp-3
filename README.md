# node-cmpp-3.0
This is an implementation for CMPP 3.0 protocol.

Now the project passed basic test. But it is not fully tested.

This project is write in Typescript 1.4.

File index.ts is example code. File client.ts is the entry.

Api:
```
   var Client = require("node-cmpp-3");
   var client = new Client({
    heartbeatInterval: 3 * 60 * 1000, //default
  	heartbeatTimeout: 60 * 1000, //default
  	heartbeatMaxAttempts: 3, //default
  	timeout:30*1000, //default
  	port:7890, //default
  	host:"127.0.0.1", //default
  	serviceId:"serviceName", //default
  	feeCode:"100", //default
  	srcId:"10xxxxxx", //default
    mobilesPerSecond:200 //default
   });
   
   client.connect("spid","secret").then(()=>{
    client.sendGroup(["136xxxxxx","137xxxxx"],"这是一条测试群发短信").catch((err)=>{
        console.log(err);
    });
  });
```

P.S. all option in constructor can be emitted.

I will be pleasure if this helps.
