import test from 'node:test';
import assert from 'node:assert/strict';
import {readAPIKey,saveAPIKey,removeAPIKey} from '../docs/portal/settings.mjs';
test('user-entered API key persists in browser storage independently of connecting',()=>{
  const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const dummy='test-key-for-browser-persistence-only';
  assert.equal(readAPIKey(),'');saveAPIKey(` ${dummy} `);assert.equal(readAPIKey(),dummy);
  assert.equal(JSON.parse(memory.get('tw.portal.apiKey')),dummy);removeAPIKey();assert.equal(readAPIKey(),'');
});
test('invalid values are rejected and blocked browser storage is reported',()=>{
  assert.throws(()=>saveAPIKey('{"private_key":"not-an-api-key"}'),/Firebase API key/);
  globalThis.localStorage={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');},removeItem:()=>{throw new Error('blocked');}};
  assert.equal(readAPIKey(),'');assert.throws(()=>saveAPIKey('test-key-for-browser-persistence-only'),/blocked saving/);assert.throws(()=>removeAPIKey(),/could not remove/);
});
