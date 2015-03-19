///<reference path='typings/node/node.d.ts' />

import Client = require("./client");

var client = new Client({

});

client.on("receive",(rst)=>{
    console.log("receive",rst);
});

client.on("deliver",(rst)=>{
    //console.log("deliver",rst);
});

client.on("error",(rst)=>{
    console.log("error",rst);
});

client.on("terminated",()=>{
    client.connect("spid","secret");
});


client.connect("spid","secret").then(()=>{
    client.sendGroup(["136xxxxxx","137xxxxx"],"这是一条测试群发短信").catch((err)=>{
        console.log(err);
    });
});
