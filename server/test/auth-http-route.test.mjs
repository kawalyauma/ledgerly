import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import authRoute from '../src/http/routes/auth.route.mjs';
import { listHttpRouteDescriptors } from '../src/http/routes.mjs';

function request(payload, { method='POST', headers={} }={}) {
  const stream=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);
  stream.method=method;
  stream.headers=headers;
  stream.socket={remoteAddress:'127.0.0.1'};
  return stream;
}

const baseConfig={
  auth:{loginCutover:'node',registerCutover:'cloudflare'},
  http:{maxRequestBodyBytes:4096,trustProxyHeaders:false},
};

test('route registry accepts the explicit public auth prefix',()=>{
  const descriptor=listHttpRouteDescriptors().find(route=>route.name==='auth');
  assert.ok(descriptor);
  assert.equal(descriptor.prefix,'/auth');
  assert.equal(descriptor.public,true);
  assert.equal(descriptor.business,false);
});

test('auth login delegates to the PostgreSQL compatibility service',async()=>{
  let received;
  const runtime={auth:{async login(input){received=input;return{accessToken:'access',refreshToken:'refresh',expiresIn:900,sessionId:'ses_1'};}}};
  const result=await authRoute.handle({
    request:request({email:'owner@example.com',password:'secret'}),
    url:new URL('http://localhost/auth/login'),
    runtime,
    config:baseConfig,
  });
  assert.equal(result.status,200);
  assert.equal(result.body.data.accessToken,'access');
  assert.equal(received.email,'owner@example.com');
  assert.equal(received.ip,'127.0.0.1');
});

test('auth registration remains fail-closed until its own cutover is node',async()=>{
  const runtime={auth:{async register(){throw new Error('must not run');}}};
  await assert.rejects(
    authRoute.handle({
      request:request({organizationName:'Test',name:'Owner',email:'owner@example.com',password:'long-enough-password'}),
      url:new URL('http://localhost/auth/register'),
      runtime,
      config:baseConfig,
    }),
    error=>error?.status===404&&error?.code==='AUTH_ROUTE_NOT_ENABLED',
  );
});

test('auth route enforces the configured request body limit for chunked bodies',async()=>{
  const runtime={auth:{async login(){throw new Error('must not run');}}};
  await assert.rejects(
    authRoute.handle({
      request:request({email:'owner@example.com',password:'this-body-is-too-large'}),
      url:new URL('http://localhost/auth/login'),
      runtime,
      config:{...baseConfig,http:{...baseConfig.http,maxRequestBodyBytes:8}},
    }),
    error=>error?.status===413&&error?.code==='SELFHOST_REQUEST_TOO_LARGE',
  );
});
