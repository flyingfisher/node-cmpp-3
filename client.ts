///<reference path='typings/node/node.d.ts' />
///<reference path='typings/bluebird/bluebird.d.ts' />
///<reference path='typings/moment/moment.d.ts' />

require("./global");
import Socket = require("./cmppSocket");
import crypto = require('crypto');
import events = require("events");
var md5 = crypto.createHash('md5');

class Client extends events.EventEmitter {
	private socket:Socket;
	private Commands = Socket.Commands;
	private spId;

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
			return this.socket.send(this.Commands.CMPP_CONNECT,{
				Source_Addr:spId,
				AuthenticatorSource:this.getAuthenticatorSource(spId,secret),
				Version:0x30, //3.0 version
				Timestamp:parseInt(this.getTimestamp())
			});
		});
	}

	bindEvent(){
		this.socket.on("deliver",(rst)=>{
			if(rst.body.Registered_Delivery === 1){
				this.emit("deliver",rst);
			}
			else{
				this.emit("receive",rst);
			}
		});

		this.socket.on("terminated",()=>{
			this.emit("terminated");
		});

		this.socket.on("error",()=>{
			this.emit("error");
		});
	}

	sendGroup(mobileList:string[],content):Promise<any>{
		if(!this.socket.isReady) return Promise.reject("socket is not Ready");
		var body = this.buildSubmitBody();
		var destBuffer = new Buffer(mobileList.length * 32);
		mobileList.forEach((mobile,index)=>{
			destBuffer.write(mobile, index * 32, 32, "ascii");
		});

		body.DestUsr_tl = mobileList.length;
		body.Dest_terminal_Id = destBuffer;
		var buf = new Buffer(content,"gbk");

		if(buf.length > 140){
			return this.sendLongSms(body,buf);
		}

		body.Msg_Length=buf.length;
		body.Msg_Content=buf;
		return this.socket.send(this.Commands.CMPP_SUBMIT, body);
	}

	private sendLongSms(body:Body, buf:Buffer):Promise<any>{
		var splitCount = Math.ceil(buf.length / 140);
		var promiseList = [];
		_.times(splitCount,(idx)=>{
			body.Pk_total = splitCount;
			body.Pk_number = idx+1;
			body.Msg_Content = buf.slice(140*idx,140*(idx+1));
			body.Msg_Length = body.Msg_Content["length"];
			promiseList.push(this.socket.send(this.Commands.CMPP_SUBMIT, body));
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