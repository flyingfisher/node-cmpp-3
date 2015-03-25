/**
 * Created by fish on 2015/3/13.
 */

///<reference path='typings/node/node.d.ts' />
///<reference path='typings/bluebird/bluebird.d.ts' />
///<reference path='typings/lodash/lodash.d.ts' />

import net = require("net");
import events = require("events");

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
    static Commands = Commands;

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
            this.send(Commands.CMPP_ACTIVE_TEST).then(()=>{
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
        return this.send(Commands.CMPP_TERMINATE).catch(()=>{}).finally(()=>{
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

        var header = this.readHeader(this.bufferCache);
        if(this.bufferCache.length < header.Total_Length) return;

        while(this.bufferCache.length >= header.Total_Length) {
            var buf = this.bufferCache.slice(0, header.Total_Length);
            this.bufferCache = this.bufferCache.slice(header.Total_Length);
            this.handleBuffer(buf,header);
        }
    }

    handleBuffer(buffer,header){
        var body = this.readBody(header.Command_Id, buffer.slice(this.headerLength));
        if(header.Command_Id === Commands.CMPP_TERMINATE){
            this.emit("terminated");
            clearTimeout(this.heartbeatHandle);
            this.isReady = false;
            this.sendResponse(Commands.CMPP_TERMINATE_RESP, header.Sequence_Id);
            Promise.delay(100).then(()=>{this.destroySocket();});
            return;
        }

        if(header.Command_Id === Commands.CMPP_DELIVER){
            this.sendResponse(Commands.CMPP_DELIVER_RESP, header.Sequence_Id,{Msg_Id:body.Msg_Id,Result:0});
            this.emit("deliver", {header:header,body:body});
            return;
        }

        if(header.Command_Id === Commands.CMPP_ACTIVE_TEST){
            this.sendResponse(Commands.CMPP_ACTIVE_TEST_RESP, header.Sequence_Id);
            return;
        }

        if(this.isResponse(header.Command_Id)) {
            var promise = this.sequencePromiseMap[header.Sequence_Id];
            if (!promise){
                this.emit("error",new Error(Commands[header.Command_Id] + ": resp has no promise handle it"));
                return;
            }
            clearTimeout(promise._timeoutHandle);
            if(this.hasError(body)){
                var msg = `command:${Commands[header.Command_Id]} failed. result:${Errors[body.Result]}`;
                promise.reject(new Error(msg));
            }else{
                promise.resolve({header:header,body:body});
            }

            delete this.sequencePromiseMap[header.Sequence_Id];

            return;
        }

        this.emit("error",new Error(Commands[header.Command_Id]+": no handler found"));
        return;
    }

    sendResponse(command:Commands,sequence:number,body?){
        var buf = this.getBuf({Sequence_Id:sequence,Command_Id:command},body);
        this.socket.write(buf);
    }

    send(command:Commands,body?:Body):Promise<any>{
        var sequence = this.sequenceHolder++;
        var buf = this.getBuf({Sequence_Id:sequence,Command_Id:command},body);
        this.socket.write(buf);
        var deferred = Promise.defer();
        this.sequencePromiseMap[sequence] = deferred;
        var timeout = this.config.timeout;
        if(command === Commands.CMPP_ACTIVE_TEST)
            timeout = this.config.heartbeatTimeout;

        deferred["_timeoutHandle"] = setTimeout(()=>{
            if(command !== Commands.CMPP_ACTIVE_TEST) {
                this.emit("timeout");
            }
            var msg = `command:${Commands[command]} timeout.`;
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

    readBody(command:Commands|string,buffer:Buffer){
        var obj:any = {};
        var commandStr;
        if(_.isNumber(command))
            commandStr = Commands[<number>command];
        else
            commandStr = command;
        var commandDesp = CommandsDescription[commandStr];
        if (!commandDesp) return obj;

        commandDesp.forEach((field:any)=>{
            obj[field.name]=this.getValue(buffer, field, obj);
        });

        if(command === Commands.CMPP_DELIVER){
            if (obj.Registered_Delivery === 1){
                obj.Msg_Content = this.readBody("CMPP_DELIVER_REPORT_CONTENT",obj.Msg_Content);
            }
            else{
                obj.Msg_Content = obj.Msg_Content.toString("gbk");
            }
        }

        return obj;
    }

    getBodyBuffer(command:Commands,body:Body){
        var buffer = new Buffer(1000);
        buffer.fill(0);

        var commandStr = Commands[command];
        var commandDesp = CommandsDescription[commandStr];
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

enum Commands{
    CMPP_CONNECT=0x00000001,
    CMPP_CONNECT_RESP=0x80000001,
    CMPP_SUBMIT=0x00000004,
    CMPP_SUBMIT_RESP=0x80000004,
    CMPP_DELIVER=0x00000005,
    CMPP_DELIVER_RESP=0x80000005,
    CMPP_ACTIVE_TEST=0x00000008,
    CMPP_ACTIVE_TEST_RESP=0x80000008,
    CMPP_TERMINATE=0x00000002,
    CMPP_TERMINATE_RESP=0x80000002,
}

enum Errors{
    消息结构错=1,
    命令字错误=2,
    消息序列号重复=3,
    消息长度错=4,
    资费代码错=5,
    超过最大信息长=6,
    业务代码错=7,
    流量控制错=8,
    本网关不负责此计费号码=9,
    Src_ID错=10,
    Msg_src错=11,
    计费地址错=12,
    目的地址错=13,
    尚未建立连接=51,
    尚未成功登录=52,
    发送消息失败=53,
    超时未接收到响应消息=54,
    等待状态报告超时=55,
    有效时间已经过期=61,
    定时发送时间已经过期=62,
    不能识别的FeeType=63,
    发送服务源地址鉴权失败=64,
    发送服务目的地址鉴权失败=65,
    接收服务源地址鉴权失败=66,
    接收服务目的地址鉴权失败=67,
    用户鉴权失败=68,
    此用户为黑名单用户=69,
    网络断连或目的设备关闭接口=70,
    超过最大节点数=71,
    找不到路由=72,
    等待应答超时=73,
    送SCP失败=74,
    送SCP鉴权等待应答超时=75,
    信息安全鉴权失败=76,
    超过最大Submit提交数=77,
    SPID为空=78,
    业务类型为空=79,
    CPCode错误=80,
    发送接收接口重复=81,
    循环路由=82,
    超过接收侧短消息MTU=83,
    送DSMP重发失败=84,
    DSMP系统忙重发=85,
    DSMP系统忙且缓存满重发=86,
    DSMP流控重发=87,
    等DSMP应答超时重发=88,
    非神州行预付费用户=202,
    数据库操作失败=203,
    移动用户帐户数据异常=206,
    用户余额不足=208,
    超过最高欠费额=210,
    重复发送消息序列号msgid相同的计费请求消息=215,
    SCP互联失败=218,
    未登记的SP=222,
    月消费超额=232,
    未定义=241,
    消息队列满=250
}

var CommandsDescription ={
    CMPP_CONNECT:[
        {name :"Source_Addr",type:"string",length:6}
        ,{name :"AuthenticatorSource",type:"buffer",length:16}
        ,{name :"Version",type:"number",length:1}
        ,{name :"Timestamp",type:"number",length:4}
    ]
    ,CMPP_CONNECT_RESP:[
        {name :"Status",type:"number",length:4}
        ,{name :"AuthenticatorSSP",type:"buffer",length:16}
        ,{name :"Version",type:"number",length:1}
    ]
    ,CMPP_SUBMIT:[
        {name:"Msg_Id",type:"buffer",length:8},
        {name:"Pk_total",type:"number",length:1}, // 短信分隔总数
        {name:"Pk_number",type:"number",length:1}, // 分隔序号
        {name:"Registered_Delivery",type:"number",length:1}, // 是否要求返回状态确认报告 1：是 0：否
        {name:"Msg_level",type:"number",length:1},
        {name:"Service_Id",type:"string",length:10}, // 自定：SJCP
        {name:"Fee_UserType",type:"number",length:1},
        {name:"Fee_terminal_Id",type:"string",length:32},
        {name:"Fee_terminal_type",type:"number",length:1}, //0:真实号码 1：伪码
        {name:"TP_pId",type:"number",length:1}, // 0, 在现在的v1短信网关中的值
        {name:"TP_udhi",type:"number",length:1}, // 0, 在现在的v1短信网关中的值
        {name:"Msg_Fmt",type:"number",length:1}, // 0：ascii，15： 含中文
        {name:"Msg_src",type:"string",length:6}, // sp_id
        {name:"FeeType",type:"string",length:2}, //01：对“计费用户号码”免费；02：对“计费用户号码”按条计信息费；03：对“计费用户号码”按包月收取信息
        {name:"FeeCode",type:"string",length:6}, //资费代码（以分为单位）。
        {name:"ValId_Time",type:"string",length:17},// 留空， 有效时间
        {name:"At_Time",type:"string",length:17},// 留空， 定时发送时间
        {name:"Src_Id",type:"string",length:21}, //源号码。SP的服务代码或前缀为服务代 码的长号码 sp_code
        {name :"DestUsr_tl",type:"number",length:1} // < 100
        ,{name :"Dest_terminal_Id",type:"string",length:(obj)=>obj.DestUsr_tl * 32}
        ,{name :"Dest_terminal_type",type:"number",length:1}
        ,{name :"Msg_Length",type:"number",length:1} //<= 140
        ,{name :"Msg_Content",type:"buffer",length:(obj)=>obj.Msg_Length}
        ,{name:"LinkID",type:"string",length:20} //留空，点播业务使用的LinkID
    ]
    ,CMPP_SUBMIT_RESP:[
        {name :"Msg_Id",type:"buffer",length:8}
        ,{name :"Result",type:"number",length:4}
    ]
    ,CMPP_DELIVER:[
        {name :"Msg_Id",type:"buffer",length:8}
        ,{name :"Dest_Id",type:"string",length:21}
        ,{name :"Service_Id",type:"string",length:10}
        ,{name :"TP_pid",type:"number",length:1}
        ,{name :"TP_udhi",type:"number",length:1}
        ,{name :"Msg_Fmt",type:"number",length:1}
        ,{name :"Src_terminal_Id",type:"string",length:32}
        ,{name :"Src_terminal_type",type:"number",length:1}
        ,{name :"Registered_Delivery",type:"number",length:1} //0 非状态报告 1 状态报告
        ,{name :"Msg_Length",type:"number",length:1}
        ,{name :"Msg_Content",type:"buffer",length:(obj)=>obj.Msg_Length}
        ,{name :"LinkID",type:"string",length:20}
    ]
    ,CMPP_DELIVER_REPORT_CONTENT:[
        {name :"Msg_Id",type:"buffer",length:8}
        ,{name :"Stat",type:"string",length:7}
        ,{name :"Submit_time",type:"string",length:10}
        ,{name :"Done_time",type:"string",length:10}
        ,{name :"Dest_terminal_Id",type:"string",length:32}
        ,{name :"SMSC_sequence",type:"number",length:4}
    ]
    ,CMPP_DELIVER_RESP:[
        {name :"Msg_Id",type:"buffer",length:8}
        ,{name :"Result",type:"number",length:4}
    ]
};

export = CMPPSocket;