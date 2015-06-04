///<reference path='typings/node/node.d.ts' />

import Client = require("./client");

var client = new Client({

});

client.on("receive",(mobile,content)=>{
    console.log("receive",mobile,content);
});

client.on("deliver",(mobile ,stat)=>{
    console.log("deliver",mobile ,stat);
});

client.on("error",(err)=>{
    console.log("error",err);
});

client.on("terminated",()=>{
    client.connect("spid","secret");
});


client.connect("spid","secret").then(()=>{
    client.sendGroup(["136xxxxxx","137xxxxx"],"这是一条测试群发短信").catch((err)=>{
        console.log(err);
    });
}).catch((err)=>{
    console.log(err);
});
