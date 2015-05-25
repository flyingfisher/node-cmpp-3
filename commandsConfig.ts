export enum Commands{
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

export enum Errors{
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

export enum Status{
    消息结构错=1,
    非法源地址=2,
    认证错=3,
    版本太高=4,
    超过系统接口数=55,
    超过帐号设置接口数=56,
    SP登陆IP错误=57,
    创建soap处理线程失败=58,
    登陆帐号并非属于登陆的PROXY=60
}

export var CommandsDescription ={
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