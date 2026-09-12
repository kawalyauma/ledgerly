import test from 'node:test';
import assert from 'node:assert/strict';

import mobileSyncExtension from '../src/extensions/mobile-sync.extension.mjs';
import {createCollection as scheduling} from '../src/mobile-sync/collections/academics-scheduling.collection.mjs';
import {createCollection as schemes} from '../src/mobile-sync/collections/academics-schemes.collection.mjs';
import {createCollection as schemeItems} from '../src/mobile-sync/collections/academics-scheme-items.collection.mjs';
import {createCollection as templates} from '../src/mobile-sync/collections/academics-templates.collection.mjs';
import {createCollection as lessonPlans} from '../src/mobile-sync/collections/academics-lesson-plans.collection.mjs';
import {createCollection as deliveries} from '../src/mobile-sync/collections/academics-deliveries.collection.mjs';
import {createCollection as supervision} from '../src/mobile-sync/collections/academics-supervision.collection.mjs';
import {createCollection as actions} from '../src/mobile-sync/collections/academics-actions.collection.mjs';

const factories=Object.freeze({
  scheduling,
  schemes,
  'scheme-items':schemeItems,
  templates,
  'lesson-plans':lessonPlans,
  deliveries,
  supervision,
  actions,
});
const writable=new Set(['schemes','scheme-items','lesson-plans','deliveries','actions']);

test('mobile-sync runtime is opt-in and honors bounded Academics rehearsal limits',()=>{
  assert.equal(mobileSyncExtension.configure({}).enabled,false);
  const config=mobileSyncExtension.configure({
    SELFHOST_MOBILE_SYNC_ENABLED:'true',
    SELFHOST_MOBILE_SYNC_MAX_PUSH:'125',
    SELFHOST_MOBILE_SYNC_MAX_PULL:'333',
  });
  assert.equal(config.enabled,true);
  assert.equal(config.maxPush,125);
  assert.equal(config.maxPull,333);
});

test('Academics registers the complete eight-collection self-hosted mobile contract',async()=>{
  const services={database:{}};
  const collections=[];
  for(const [collectionKey,factory] of Object.entries(factories)){
    const definition=await factory({services});
    assert.equal(definition.moduleKey,'academics');
    assert.equal(definition.collectionKey,collectionKey);
    assert.equal(typeof definition.canRead,'function');
    assert.equal(typeof definition.apply==='function',writable.has(collectionKey));
    collections.push(definition.collectionKey);
  }
  assert.deepEqual(collections.sort(),[
    'actions','deliveries','lesson-plans','scheduling','scheme-items','schemes','supervision','templates',
  ]);
});
