/**
 * Created by fish on 2015/3/13.
 */

///<reference path='typings/node/node.d.ts' />
///<reference path='typings/bluebird/bluebird.d.ts' />
///<reference path='typings/lodash/lodash.d.ts' />

import net = require("net");
import events = require("events");
import cmdCfg = require("./commandsConfig");

var iconv = require("iconv-lite");
iconv.extendNodeEncodings();

class CMPPSocket extends events.EventEmitter{
    private socket:net.Socket;
    private sequencePromiseMap;
    private sequenceHolder = 1;
    private heartbeatAttempts;
    private heartbeatHandle;
    private headerLength = 12;
    private bufferCache:Buffer;

    public isReady:boolean;
    static Commands = cmdCfg.Commands;

    constructor(private config){
        super();
        this.sequencePromiseMap = {};
        this.isReady=false;
        this.heartbeatAttempts = 0;
    }

    handleHeartbeat(){
        if(this.isReady){
            this.heartbeatAttempts++;
            if(this.heartbeatAttempts > this.config.heartbeatMaxAttempts){
                this.disconnect();
                this.emit("terminated");
            }
            this.send(cmdCfg.Commands.CMPP_ACTIVE_TEST).then(()=>{
                this.heartbeatAttempts = 0;
            }).catch(()=>{});
        }

        this.heartbeatHandle=setTimeout(()=>{
            this.handleHeartbeat();
        },this.config.heartbeatInterval);
    }

    connect(port, host?):Promise<any> {
        return this.connectSocket(port,host).then(()=>{
            this.handleHeartbeat();
            this.isReady = true;
            this.sequenceHolder = 1;
        }).catch((err)=> {
                console.error(err);
                this.destroySocket();
            });
    }

    private connectSocket(port,host):Promise<any>{
        if(this.isReady) return Promise.resolve();
        if(this.socket) return Promise.resolve();

        var deferred = Promise.defer();
        this.socket = new net.Socket();
        this.socket.on("data", (buffer)=> {
            this.handleData(buffer);
        });
        this.socket.on("error", (err)=> {
            this.emit("error", err);
            deferred.reject(err);
            this.destroySocket();
        });
        this.socket.on("connect", ()=> {
            deferred.resolve();
        });
        this.socket.connect(port, host);

        return deferred.promise;
    }

    disconnect(){
        this.isReady = false;
        clearTimeout(this.heartbeatHandle);
        return this.send(cmdCfg.Commands.CMPP_TERMINATE).catch(()=>{}).finally(()=>{
            this.destroySocket();
        })
    }

    private destroySocket(){
        this.isReady = false;
        if(this.socket) {
            this.socket.end();
            this.socket.destroy();
            this.socket = undefined;
        }
    }

    handleData(buffer){
        if(!this.bufferCache) {
            this.bufferCache = buffer;
        }else{
            this.bufferCache = Buffer.concat([this.bufferCache,buffer]);
        }

        var obj = {header:undefined,buffer:undefined};
        while(this.fetchData(obj)){
            this.handleBuffer(obj.buffer,obj.header);
        }        
    }
    
    fetchData(obj){
        if(!obj) return false;
        if(this.bufferCache.length<12) return false;
        
        obj.header = this.readHeader(this.bufferCache);
        if(this.bufferCache.length < obj.header.Total_Length) return false;
        
        obj.buffer = this.bufferCache.slice(0, obj.header.Total_Length);
        this.bufferCache = this.bufferCache.slice(obj.header.Total_Length);
        return true;
    }
    
    handleBuffer(buffer,header){
        var body = this.readBody(header.Command_Id, buffer.slice(this.headerLength));
        if(header.Command_Id === cmdCfg.Commands.CMPP_TERMINATE){
            this.emit("terminated");
            clearTimeout(this.heartbeatHandle);
            this.isReady = false;
            this.sendResponse(cmdCfg.Commands.CMPP_TERMINATE_RESP, header.Sequence_Id);
            Promise.delay(100).then(()=>{this.destroySocket();});
            return;
        }

        if(header.Command_Id === cmdCfg.Commands.CMPP_DELIVER){
            this.sendResponse(cmdCfg.Commands.CMPP_DELIVER_RESP, header.Sequence_Id,{Msg_Id:body.Msg_Id,Result:0});
            this.emit("deliver", {header:header,body:body});
            return;
        }

        if(header.Command_Id === cmdCfg.Commands.CMPP_ACTIVE_TEST){
            this.sendResponse(cmdCfg.Commands.CMPP_ACTIVE_TEST_RESP, header.Sequence_Id);
            return;
        }

        if(this.isResponse(header.Command_Id)) {
            var promise = this.popPromise(header.Sequence_Id);
            if (!promise) {
                this.emit("error", new Error(cmdCfg.Commands[header.Command_Id] + ": resp has no promise handle it"));
                return;
            }
            clearTimeout(promise._timeoutHandle);
            if(this.hasError(body)){
                var result = `result:${cmdCfg.Errors[body.Result]||body.Result}`;
                if(header.Command_Id === cmdCfg.Commands.CMPP_CONNECT_RESP)
                    result = `status:${cmdCfg.Status[body.Status]||body.Status}`;

                var msg = `command:${cmdCfg.Commands[header.Command_Id]} failed. result:${result}`;
                promise.reject(new Error(msg));
            }else{
                promise.resolve({header:header,body:body});
            }

            return;
        }

        this.emit("error",new Error(cmdCfg.Commands[header.Command_Id]+": no handler found"));
        return;
    }

    sendResponse(command:cmdCfg.Commands,sequence:number,body?){
        var buf = this.getBuf({Sequence_Id:sequence,Command_Id:command},body);
        this.socket.write(buf);
    }

    pushPromise(sequence,deferred){
        if(!this.sequencePromiseMap[sequence])
            this.sequencePromiseMap[sequence] = deferred;
        else if (_.isArray(this.sequencePromiseMap[sequence]))
            this.sequencePromiseMap[sequence].push(deferred);
        else
            this.sequencePromiseMap[sequence]=[this.sequencePromiseMap[sequence],deferred];
    }

    popPromise(sequence){
        if(!this.sequencePromiseMap[sequence]) return;
        if (_.isArray(this.sequencePromiseMap[sequence])){
            var promise = this.sequencePromiseMap[sequence].shift();
            if(_.isEmpty(this.sequencePromiseMap[sequence]))
                delete this.sequencePromiseMap[sequence];
            return promise;
        }

        var promise = this.sequencePromiseMap[sequence];
        delete this.sequencePromiseMap[sequence];
        return promise;
    }

    send(command:cmdCfg.Commands, body?:Body):Promise<any>{
        var deferred = Promise.defer();

        if(_.keys(this.sequencePromiseMap).length > this.config.transationsPerSecond){
            deferred.reject(new Error(`cmpp exceed max transationsPerSecond[${this.config.transationsPerSecond}], please retry later`));
            return deferred.promise;
        }        

        if(body && body["Pk_number"] === 1){
            this.sequenceHolder++;
        }

        var sequence = this.sequenceHolder;
        var buf = this.getBuf({Sequence_Id:sequence,Command_Id:command},body);
        this.socket.write(buf);
        this.pushPromise(sequence, deferred);

        var timeout = this.config.timeout;
        if(command === cmdCfg.Commands.CMPP_ACTIVE_TEST)
            timeout = this.config.heartbeatTimeout;

        deferred["_timeoutHandle"] = setTimeout(()=>{
            if(command !== cmdCfg.Commands.CMPP_ACTIVE_TEST) {
                this.emit("timeout");
            }
            var msg = `command:${cmdCfg.Commands[command]} timeout.`;
            deferred.reject(new Error(msg));
        },timeout);

        return deferred.promise;
    }

    getBuf(header,body){
        header.Total_Length = this.headerLength;
        var headBuf:Buffer,bodyBuf;
        if(body){
            bodyBuf = this.getBodyBuffer(header.Command_Id,body);
            header.Total_Length += bodyBuf.length;
        }

        headBuf = this.getHeaderBuffer(header);
        if(bodyBuf)
            return Buffer.concat([headBuf,bodyBuf]);
        else
            return headBuf;
    }

    hasError(body:Body){
        return body.Status !== void 0 && body.Status > 0 || body.Result !== void 0 && body.Result > 0
    }

    isResponse(Command_Id){
        return Command_Id > 0x80000000;
    }

    readHeader(buffer:Buffer):Header{
        var obj=<Header>{};
        obj.Total_Length=buffer.readUInt32BE(0);
        obj.Command_Id=buffer.readUInt32BE(4);
        obj.Sequence_Id=buffer.readUInt32BE(8);
        return obj;
    }

    getHeaderBuffer(header:Header){
        var buffer = new Buffer(this.headerLength);
        buffer.writeUInt32BE(header.Total_Length,0);
        buffer.writeUInt32BE(header.Command_Id,4);
        buffer.writeUInt32BE(header.Sequence_Id,8);
        return buffer;
    }

    readBody(command:cmdCfg.Commands|string,buffer:Buffer){
        var obj:any = {};
        var commandStr;
        if(_.isNumber(command))
            commandStr = cmdCfg.Commands[<number>command];
        else
            commandStr = command;
        var commandDesp = cmdCfg.CommandsDescription[commandStr];
        if (!commandDesp) return obj;

        commandDesp.forEach((field:any)=>{
            obj[field.name]=this.getValue(buffer, field, obj);
        });

        if(command === cmdCfg.Commands.CMPP_DELIVER){
            if (obj.Registered_Delivery === 1){
                obj.Msg_Content = this.readBody("CMPP_DELIVER_REPORT_CONTENT",obj.Msg_Content);
            }
            else{
                obj.Msg_Content = obj.Msg_Content.toString("gbk");
            }
        }

        return obj;
    }

    getBodyBuffer(command:cmdCfg.Commands,body:Body){
        var buffer = new Buffer(1024 * 1024);
        buffer.fill(0);

        var commandStr = cmdCfg.Commands[command];
        var commandDesp = cmdCfg.CommandsDescription[commandStr];
        if (!commandDesp) return buffer.slice(0,0);

        body._length = 0;
        commandDesp.forEach((field)=>{
            this.writeBuf(buffer, field, body);
        });

        return buffer.slice(0,body._length);
    }

    getValue(buffer,field,obj){
        var length = obj._length || 0;
        if (length >= buffer.length) return;

        var fieldLength = this.getLength(field,obj);
        obj._length = length + fieldLength;

        if (field.type === "number"){
            var bitLength = fieldLength * 8;
            var method = `readUInt${bitLength}BE`;
            if (bitLength === 8)
                method = `readUInt${bitLength}`;

            return buffer[method](length);
        } else if (field.type === "string"){
            var value = buffer.toString(field.encoding || "ascii", length, length + fieldLength);
            return value.replace(/\0+$/, '');
        } else if (field.type === "buffer"){
            return buffer.slice(length,length+fieldLength);
        }
    }

    writeBuf(buffer:Buffer,field,body){
        var length = body._length || 0;
        var fieldLength = this.getLength(field,body);
        var value = body[field.name];
        body._length = length + fieldLength;

        if(value instanceof Buffer){
            value.copy(buffer,length,0,fieldLength);
        }else {
            if (field.type === "number" && _.isNumber(value)) {
                var bitLength = fieldLength * 8;
                var method = `writeUInt${bitLength}BE`;
                if (bitLength === 8)
                    method = `writeUInt${bitLength}`;

                buffer[method](value, length);
            } else if (field.type === "string") {
                if(!value) value="";
                buffer.write(value, length, fieldLength, field.encoding || "ascii");
            }
        }
    }

    getLength(field, obj) {
        if (_.isFunction(field.length)) {
            return field.length(obj);
        }

        return field.length;
    }
}

interface Header{
    Total_Length?:number;Command_Id:number;Sequence_Id?:number
}

interface Body{
    Status?:number;
    Result?:number;
    _length?:number;
}

export = CMPPSocket;