///<reference path='typings/node/node.d.ts' />
///<reference path='typings/bluebird/bluebird.d.ts' />
///<reference path='typings/moment/moment.d.ts' />

require("./global");
import Socket = require("./cmppSocket");
import crypto = require('crypto');
import events = require("events");
var md5 = crypto.createHash('md5');
import cmdCfg = require("./commandsConfig");

class Client extends events.EventEmitter {
	private socket:Socket;
	private spId;
	contentLimit=70;
	longSmsBufLimit=140;
	private sendingMobileCount = 0;

	public deliverConst = ReportStat;

	constructor(private config){
		super();
		_.defaults(config,require("./config"));
		this.socket = new Socket(config);
		this.bindEvent();
	}

	connect(spId,secret){
		if(this.socket.isReady) return Promise.resolve();

		this.spId = spId;
		return this.socket.connect(this.config.port,this.config.host).then(()=>{
			return this.socket.send(cmdCfg.Commands.CMPP_CONNECT,{
				Source_Addr:spId,
				AuthenticatorSource:this.getAuthenticatorSource(spId,secret),
				Version:0x30, //3.0 version
				Timestamp:parseInt(this.getTimestamp())
			});
		});
	}

	bindEvent(){
		this.socket.on("deliver",(rst)=>{
			var body = <Body>rst.body;
			if(body.Registered_Delivery === 1){
				this.sendingMobileCount--;
				this.emit("deliver", body.Msg_Content["Dest_terminal_Id"], body.Msg_Content["Stat"]);				
			}
			else{
				this.emit("receive", body.Src_terminal_Id, body.Msg_Content);
			}
		});

		this.socket.on("terminated",()=>{
			this.emit("terminated");
		});

		this.socket.on("error",(err)=>{
			this.emit("error", err);
		});
	}

	sendGroup(mobileList:string[],content):Promise<any>{
		if (!this.socket.isReady) return Promise.reject(new Error("socket is not Ready"));
		if ((this.sendingMobileCount + mobileList.length) > this.config.mobilesPerSecond){
			return Promise.reject(new Error(`cmpp exceed max mobilesPerSecond[${this.config.mobilesPerSecond}], please retry later`));
		}
		
		this.sendingMobileCount += mobileList.length;
		
		var body = this.buildSubmitBody();
		var destBuffer = new Buffer(mobileList.length * 32);
		destBuffer.fill(0);
		mobileList.forEach((mobile,index)=>{
			destBuffer.write(mobile, index * 32, 32, "ascii");
		});

		body.DestUsr_tl = mobileList.length;
		body.Dest_terminal_Id = destBuffer;

		if(content.length > this.contentLimit){
			return this.sendLongSms(body, content);
		}

		var buf = new Buffer(content, "gbk");
		body.Msg_Length=buf.length;
		body.Msg_Content=buf;
		return this.socket.send(cmdCfg.Commands.CMPP_SUBMIT, body);
	}

	private sendLongSms(body:Body, content):Promise<any>{
		var buf = new Buffer(content,"utf16");

		var bufSliceCount = this.longSmsBufLimit - 8;

		var splitCount = Math.ceil(buf.length / bufSliceCount);

		var tp_udhiHead_buf = new Buffer(7);
		tp_udhiHead_buf[0] = 6;
		tp_udhiHead_buf[1] = 8;
		tp_udhiHead_buf[2] = 4;
		tp_udhiHead_buf[3] = _.random(127);
		tp_udhiHead_buf[4] = _.random(127);

		tp_udhiHead_buf[5] = splitCount;

		var promiseList = [];
		_.times(splitCount,(idx)=>{
			tp_udhiHead_buf[6] = idx + 1;
			body.TP_udhi = 1;
			body.Msg_Fmt = 8;
			body.Pk_total = splitCount;
			body.Pk_number = idx + 1;
			body.Msg_Content = Buffer.concat([tp_udhiHead_buf, buf.slice(bufSliceCount*idx,bufSliceCount*(idx+1))]);
			body.Msg_Length = body.Msg_Content["length"];
			promiseList.push(this.socket.send(cmdCfg.Commands.CMPP_SUBMIT, body));
		});

		return Promise.all(promiseList);
	}

	send(mobile,content):Promise<any>{
		return this.sendGroup([mobile],content);
	}

	buildSubmitBody(){
		return <Body>{
			Pk_total:1,
			Pk_number:1,
			Registered_Delivery:1,
			Msg_level:1,
			Service_Id:this.config.serviceId,
			Fee_UserType:2,
			Fee_terminal_Id:"",
			Fee_terminal_type:1,
			TP_pId:0,
			TP_udhi:0,
			Msg_Fmt:15,
			Msg_src:this.spId,
			FeeType:"03",
			FeeCode:this.config.feeCode,
			ValId_Time:"",
			At_Time:"",
			Src_Id:this.config.srcId,
			DestUsr_tl:1,
			Dest_terminal_Id:"",
			Dest_terminal_type:0,
			Msg_Length:0,
			Msg_Content:"",
			LinkID:""
		}
	}

	disconnect(){
		if(!this.socket.isReady) return Promise.resolve();

		return this.socket.disconnect();
	}

	getAuthenticatorSource(spId,secret){
		var buffer = new Buffer(31);
		buffer.fill(0);
		buffer.write(spId,0,6,"ascii");
		buffer.write(secret,15,21,"ascii");
		buffer.write(this.getTimestamp(),21,10,"ascii");
		md5.update(buffer);
		return md5.digest();
	}

	getTimestamp(){
		return moment().format("MMDDHHmmss");
	}
}

interface Header{
	Total_Length?:number;Command_Id:number;Sequence_Id?:number
}

interface Body{
	Status?:number;
	Result?:number;
	Source_Addr?:string;
	AuthenticatorSource?:Buffer;
	AuthenticatorSSP?:Buffer;
	Msg_Id?:Buffer;
	Pk_total?:number;
	Pk_number?:number;
	Registered_Delivery?:number;
	Msg_level?:number;
	Service_Id?:string;
	Fee_UserType?:number;
	Fee_terminal_Id?:string;
	Fee_terminal_type?:number;
	TP_pId?:number;
	TP_udhi?:number;
	Msg_Fmt?:number;
	Msg_src?:string;
	FeeType?:string;
	FeeCode?:string;
	ValId_Time?:string;
	At_Time?:string;
	Src_Id?:string;
	DestUsr_tl?:number;
	Dest_terminal_Id?:string|Buffer;
	Dest_terminal_type?:number;
	Msg_Length?:number;
	Msg_Content?:{
		Msg_Id:Buffer;
		Stat:string;
		Submit_time:string;
		Done_time:string;
		Dest_terminal_Id:string;
		SMSC_sequence:number;
	}|Buffer|string;
	LinkID?:string;
	Dest_Id?:string;
	Src_terminal_Id?:string;
	Src_terminal_type?:number;
	Version?:number;
	Timestamp?:number;
	_length?:number;
}


var ReportStat = {
	DELIVERED:"DELIVRD",
	EXPIRED:"EXPIRED",
	DELETED:"DELETED",
	UNDELIVERABLE:"UNDELIV",
	ACCEPTED:"ACCEPTD",
	UNKONWN:"UNKNOWN",
	REJECTED:"REJECTD"
};

export = Client;