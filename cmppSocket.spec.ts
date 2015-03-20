/**
 * Created by fish on 2015/3/16.
 */

///<reference path='typings/node/node.d.ts' />
///<reference path='typings/bluebird/bluebird.d.ts' />
///<reference path='typings/mocha/mocha.d.ts' />

require("./global");
import assert = require("assert");
import Socket = require("./cmppSocket");

describe("cmppSocket Test",()=>{
    var socket = new Socket({});
    describe("writeBuf test",()=>{
        it("should write correct 8 bit int",()=>{
            var buffer = new Buffer(10);
            var body:any = {test:1};
            socket.writeBuf(buffer,{name:"test",type:"number",length:1},body);
            assert.equal(buffer[0],1);
            assert.equal(body._length,1);

            body.test=255;
            socket.writeBuf(buffer,{name:"test",type:"number",length:1},body);
            assert.equal(buffer[1],255);
            assert.equal(body._length,2);
        });

        it("should write correct 16 bit int",()=>{
            var buffer = new Buffer(10);
            var body:any = {test:256};
            socket.writeBuf(buffer,{name:"test",type:"number",length:2},body);
            assert.equal(buffer[0],1);
            assert.equal(buffer[1],0);
            assert.equal(body._length,2);
        });

        it("should write correct string",()=>{
            var buffer = new Buffer(10);
            buffer.fill(0);
            var body:any = {test:"tes"};
            socket.writeBuf(buffer,{name:"test",type:"string",length:4},body);
            assert.equal(buffer[3],0);
            assert.equal(body._length,4);
            body.test="test";
            socket.writeBuf(buffer,{name:"test",type:"string",length:4},body);
            assert.equal(buffer[3],0);
            assert.equal(body._length,8);
        });
    });

    describe("getValue test",()=>{
        it("should get correct 8 bit int",()=>{
            var buffer = new Buffer(10);
            var body:any = {test:1};
            socket.writeBuf(buffer,{name:"test",type:"number",length:1},body);
            body.test=255;
            socket.writeBuf(buffer,{name:"test",type:"number",length:1},body);

            body._length=0;
            assert.equal(socket.getValue(buffer,{name:"test",type:"number",length:1},body),1);
            assert.equal(body._length,1);

            assert.equal(socket.getValue(buffer,{name:"test",type:"number",length:1},body),255);
            assert.equal(body._length,2);
        });

        it("should get correct 16 bit int",()=>{
            var buffer = new Buffer(10);
            var body:any = {test:1};
            socket.writeBuf(buffer,{name:"test",type:"number",length:2},body);
            body.test=256;
            socket.writeBuf(buffer,{name:"test",type:"number",length:2},body);

            body._length=0;
            assert.equal(socket.getValue(buffer,{name:"test",type:"number",length:2},body),1);
            assert.equal(body._length,2);

            assert.equal(socket.getValue(buffer,{name:"test",type:"number",length:2},body),256);
            assert.equal(body._length,4);
        });

        it("should get correct string",()=>{
            var buffer = new Buffer(10);
            buffer.fill(0);
            var body:any = {test:"tes"};
            socket.writeBuf(buffer,{name:"test",type:"string",length:4},body);
            body.test="test";
            socket.writeBuf(buffer,{name:"test",type:"string",length:4},body);

            body._length=0;
            assert.equal(socket.getValue(buffer,{name:"test",type:"string",length:4},body),"tes");
            assert.equal(body._length,4);

            assert.equal(socket.getValue(buffer,{name:"test",type:"string",length:4},body),"test");
            assert.equal(body._length,8);
        });
    });


});