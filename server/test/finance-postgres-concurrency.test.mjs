import assert from 'node:assert/strict';
import test, {after, before} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDatabase} from '../src/adapters/postgres-database.mjs';
import {FinanceTransactions} from '../src/finance/transactions.mjs';

const connectionString=process.env.LEDGERLY_TEST_DATABASE_URL;
const enabled=Boolean(connectionString);
const suite=enabled?test:test.skip;
let pool;
let database;
let schema;

before(async()=>{
  if(!enabled)return;
  schema=`finance_it_${randomUUID().replaceAll('-','')}`;
  const bootstrap=new Pool({connectionString});
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  await bootstrap.end();
  pool=new Pool({connectionString,options:`-c search_path=${schema}` ,max:8});
  database=new PostgresDatabase({pool});
  await database.query(`
    CREATE TABLE payments(
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      type text NOT NULL,
      contact_id text NOT NULL,
      currency text NOT NULL,
      amount_minor bigint NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE documents(
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      type text NOT NULL,
      contact_id text NOT NULL,
      currency text NOT NULL,
      total_minor bigint NOT NULL,
      paid_minor bigint NOT NULL DEFAULT 0,
      status text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payment_allocations(
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      payment_id text NOT NULL,
      document_id text NOT NULL,
      amount_minor bigint NOT NULL,
      reversed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE journal_entries(
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      status text NOT NULL,
      posted_at timestamptz,
      posted_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE journal_lines(
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      journal_entry_id text NOT NULL,
      debit_minor bigint NOT NULL DEFAULT 0,
      credit_minor bigint NOT NULL DEFAULT 0
    );
  `);
});

after(async()=>{
  if(!enabled)return;
  await pool.end();
  const cleanup=new Pool({connectionString});
  await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await cleanup.end();
});

async function resetAllocationFixture(){
  await database.query('TRUNCATE payment_allocations,documents,payments');
  await database.query(`INSERT INTO payments(id,organization_id,type,contact_id,currency,amount_minor,status) VALUES('p1','o1','receipt','c1','UGX',100,'posted')`);
  await database.query(`INSERT INTO documents(id,organization_id,type,contact_id,currency,total_minor,paid_minor,status) VALUES ('d1','o1','invoice','c1','UGX',100,0,'open'),('d2','o1','invoice','c1','UGX',100,0,'open')`);
}

suite('simultaneous allocations cannot over-allocate one payment',async()=>{
  await resetAllocationFixture();
  const service=new FinanceTransactions({database});
  const results=await Promise.allSettled([
    service.allocatePayment({organizationId:'o1',allocationId:'a1',paymentId:'p1',documentId:'d1',amountMinor:70}),
    service.allocatePayment({organizationId:'o1',allocationId:'a2',paymentId:'p1',documentId:'d2',amountMinor:70}),
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const rejected=results.find(x=>x.status==='rejected');
  assert.ok(['PAYMENT_OVERALLOCATED','DOCUMENT_OVERALLOCATED'].includes(rejected.reason?.code));
  const total=await database.query(`SELECT COALESCE(SUM(amount_minor),0)::bigint AS amount FROM payment_allocations WHERE organization_id='o1' AND reversed_at IS NULL`);
  assert.equal(String(total.rows[0].amount),'70');
});

suite('simultaneous retry with the same allocation id is idempotent',async()=>{
  await resetAllocationFixture();
  const service=new FinanceTransactions({database});
  const results=await Promise.allSettled([
    service.allocatePayment({organizationId:'o1',allocationId:'same-key',paymentId:'p1',documentId:'d1',amountMinor:20}),
    service.allocatePayment({organizationId:'o1',allocationId:'same-key',paymentId:'p1',documentId:'d1',amountMinor:20}),
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
  assert.equal(results.some(x=>x.status==='fulfilled'&&x.value.alreadyApplied===true),true);
  const rows=await database.query(`SELECT id,amount_minor FROM payment_allocations WHERE organization_id='o1'`);
  assert.equal(rows.rowCount,1);
  assert.equal(String(rows.rows[0].amount_minor),'20');
  const doc=await database.query(`SELECT paid_minor FROM documents WHERE id='d1' AND organization_id='o1'`);
  assert.equal(String(doc.rows[0].paid_minor),'20');
});

suite('allocation lookup cannot cross tenant boundaries',async()=>{
  await resetAllocationFixture();
  const service=new FinanceTransactions({database});
  await assert.rejects(
    service.allocatePayment({organizationId:'o2',allocationId:'tenant-test',paymentId:'p1',documentId:'d1',amountMinor:10}),
    error=>error?.code==='ALLOCATION_TARGET_NOT_FOUND',
  );
  const rows=await database.query(`SELECT id FROM payment_allocations WHERE id='tenant-test'`);
  assert.equal(rows.rowCount,0);
});

suite('unbalanced journal posting rolls back against PostgreSQL',async()=>{
  await database.query('TRUNCATE journal_lines,journal_entries');
  await database.query(`INSERT INTO journal_entries(id,organization_id,status) VALUES('j1','o1','draft')`);
  await database.query(`INSERT INTO journal_lines(id,organization_id,journal_entry_id,debit_minor,credit_minor) VALUES ('l1','o1','j1',100,0),('l2','o1','j1',0,90)`);
  const service=new FinanceTransactions({database});
  await assert.rejects(service.postJournal({organizationId:'o1',journalId:'j1',actorId:'u1'}),error=>error?.code==='UNBALANCED_JOURNAL');
  const journal=await database.query(`SELECT status,posted_at FROM journal_entries WHERE id='j1' AND organization_id='o1'`);
  assert.equal(journal.rows[0].status,'draft');
  assert.equal(journal.rows[0].posted_at,null);
});
