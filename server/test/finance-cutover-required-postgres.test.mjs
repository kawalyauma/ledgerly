import assert from 'node:assert/strict';
import test, {after, before} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDatabase} from '../src/adapters/postgres-database.mjs';
import {FinanceTransactions} from '../src/finance/transactions.mjs';
import {schoolFeeReceiptReversalHandler} from '../src/finance/school-fees-reversal.mjs';
import {PayrollTransactions} from '../src/finance/payroll-transactions.mjs';
import {FinanceAccountsService} from '../src/finance/accounts-service.mjs';
import schoolFeesRoute from '../src/http/routes/school-fees.route.mjs';
import payrollRoute from '../src/http/routes/payroll.route.mjs';

const connectionString=process.env.LEDGERLY_TEST_DATABASE_URL;
const pgtest=connectionString?test:test.skip;
let bootstrap,pool,database,schema;

before(async()=>{
  if(!connectionString)return;
  schema=`finance_cutover_${randomUUID().replaceAll('-','')}`;
  bootstrap=new Pool({connectionString});
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  await bootstrap.end();
  pool=new Pool({connectionString,options:`-c search_path=${schema}`,max:8});
  database=new PostgresDatabase({pool});
  await database.query(`
    CREATE TABLE journal_entries(
      id text PRIMARY KEY, organization_id text NOT NULL, entry_number text,
      transaction_date date, posting_date date, description text, reference text,
      source_type text, source_id text, status text NOT NULL, currency text,
      exchange_rate_micros bigint DEFAULT 1000000, reversal_of_id text,
      posted_at timestamptz, posted_by text, idempotency_key text, metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE journal_lines(
      id text PRIMARY KEY, organization_id text NOT NULL, journal_entry_id text NOT NULL,
      account_id text, description text, debit_minor bigint NOT NULL DEFAULT 0,
      credit_minor bigint NOT NULL DEFAULT 0, base_debit_minor bigint NOT NULL DEFAULT 0,
      base_credit_minor bigint NOT NULL DEFAULT 0, contact_id text, project_id text,
      class_id text, department_id text, location_id text, tax_code text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payments(
      id text PRIMARY KEY, organization_id text NOT NULL, type text NOT NULL DEFAULT 'payment',
      contact_id text, currency text NOT NULL DEFAULT 'UGX', amount_minor bigint NOT NULL,
      status text NOT NULL, journal_entry_id text, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE documents(
      id text PRIMARY KEY, organization_id text NOT NULL, type text NOT NULL DEFAULT 'invoice',
      contact_id text, currency text NOT NULL DEFAULT 'UGX', total_minor bigint NOT NULL,
      paid_minor bigint NOT NULL DEFAULT 0, status text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payment_allocations(
      id text PRIMARY KEY, organization_id text NOT NULL, payment_id text NOT NULL,
      document_id text NOT NULL, amount_minor bigint NOT NULL, reversed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE school_fee_receipts(
      id text PRIMARY KEY, organization_id text NOT NULL, payment_id text NOT NULL,
      status text NOT NULL, reversed_at timestamptz, notes text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE school_student_fee_charges(
      id text PRIMARY KEY, organization_id text NOT NULL, document_id text NOT NULL,
      status text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payroll_runs(
      id text PRIMARY KEY, organization_id text NOT NULL, status text NOT NULL,
      journal_entry_id text, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payroll_lines(
      id text PRIMARY KEY, organization_id text NOT NULL, payroll_run_id text,
      net_minor bigint NOT NULL, paid_minor bigint NOT NULL DEFAULT 0,
      balance_minor bigint NOT NULL, payment_status text NOT NULL DEFAULT 'unpaid',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE school_staff_salary_payments(
      id text PRIMARY KEY, organization_id text NOT NULL, staff_id text NOT NULL,
      payroll_line_id text NOT NULL, payment_id text NOT NULL, amount_minor bigint NOT NULL,
      payment_date date NOT NULL, status text NOT NULL, created_by text NOT NULL,
      reversed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,payment_id)
    );
  `);
});

after(async()=>{
  if(!connectionString)return;
  await pool.end();
  const cleanup=new Pool({connectionString});
  await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await cleanup.end();
});

async function reset(){
  await database.query('TRUNCATE school_staff_salary_payments,payroll_lines,payroll_runs,school_student_fee_charges,school_fee_receipts,payment_allocations,documents,payments,journal_lines,journal_entries');
}

async function seedFeeReceipt({paidMinor=100,allocationMinor=100}={}){
  await reset();
  await database.query(`INSERT INTO journal_entries(id,organization_id,entry_number,transaction_date,posting_date,description,source_type,status,currency,exchange_rate_micros) VALUES('j-fee','o1','JE-1','2026-09-12','2026-09-12','School fees','school_fee_receipt','posted','UGX',1000000)`);
  await database.query(`INSERT INTO journal_lines(id,organization_id,journal_entry_id,account_id,debit_minor,credit_minor,base_debit_minor,base_credit_minor) VALUES('jl-1','o1','j-fee','cash',100,0,100,0),('jl-2','o1','j-fee','fees',0,100,0,100)`);
  await database.query(`INSERT INTO payments(id,organization_id,type,contact_id,currency,amount_minor,status,journal_entry_id) VALUES('p-fee','o1','receipt','student-1','UGX',100,'posted','j-fee')`);
  await database.query(`INSERT INTO documents(id,organization_id,type,contact_id,currency,total_minor,paid_minor,status) VALUES('d-fee','o1','invoice','student-1','UGX',100,$1,$2)`,[paidMinor,paidMinor===100?'paid':'partially_paid']);
  await database.query(`INSERT INTO payment_allocations(id,organization_id,payment_id,document_id,amount_minor) VALUES('a-fee','o1','p-fee','d-fee',$1)`,[allocationMinor]);
  await database.query(`INSERT INTO school_fee_receipts(id,organization_id,payment_id,status) VALUES('r-fee','o1','p-fee','posted')`);
  await database.query(`INSERT INTO school_student_fee_charges(id,organization_id,document_id,status) VALUES('c-fee','o1','d-fee','settled')`);
}

function feeFinance(){return new FinanceTransactions({database,sourceReversalHandlers:new Map([['school_fee_receipt',schoolFeeReceiptReversalHandler()]])});}

pgtest('journal reversal atomically reverses originating School Fees receipt graph',async()=>{
  await seedFeeReceipt();
  const result=await feeFinance().reverseJournal({organizationId:'o1',journalId:'j-fee',actorId:'u1',postingDate:'2026-09-12',reason:'duplicate receipt',reversalId:'j-fee-r',reversalNumber:'JE-R-1'});
  assert.equal(result.status,'reversed');
  const [journal,reversal,payment,receipt,allocation,document,charge]=await Promise.all([
    database.query(`SELECT status FROM journal_entries WHERE id='j-fee'`),
    database.query(`SELECT status,reversal_of_id FROM journal_entries WHERE id='j-fee-r'`),
    database.query(`SELECT status FROM payments WHERE id='p-fee'`),
    database.query(`SELECT status,reversed_at FROM school_fee_receipts WHERE id='r-fee'`),
    database.query(`SELECT reversed_at FROM payment_allocations WHERE id='a-fee'`),
    database.query(`SELECT paid_minor,status FROM documents WHERE id='d-fee'`),
    database.query(`SELECT status FROM school_student_fee_charges WHERE id='c-fee'`),
  ]);
  assert.equal(journal.rows[0].status,'reversed');
  assert.deepEqual([reversal.rows[0].status,reversal.rows[0].reversal_of_id],['posted','j-fee']);
  assert.equal(payment.rows[0].status,'reversed');
  assert.equal(receipt.rows[0].status,'reversed');
  assert.ok(receipt.rows[0].reversed_at);
  assert.ok(allocation.rows[0].reversed_at);
  assert.deepEqual([String(document.rows[0].paid_minor),document.rows[0].status],['0','open']);
  assert.equal(charge.rows[0].status,'invoiced');
});

pgtest('School Fees reversal conflict rolls the journal and source graph back together',async()=>{
  await seedFeeReceipt({paidMinor:50,allocationMinor:100});
  await assert.rejects(feeFinance().reverseJournal({organizationId:'o1',journalId:'j-fee',actorId:'u1',postingDate:'2026-09-12',reason:'conflict test',reversalId:'j-fee-r',reversalNumber:'JE-R-2'}),e=>e?.code==='DOCUMENT_REVERSAL_CONFLICT');
  const [journal,reversal,payment,receipt,allocation,document]=await Promise.all([
    database.query(`SELECT status FROM journal_entries WHERE id='j-fee'`),
    database.query(`SELECT id FROM journal_entries WHERE id='j-fee-r'`),
    database.query(`SELECT status FROM payments WHERE id='p-fee'`),
    database.query(`SELECT status FROM school_fee_receipts WHERE id='r-fee'`),
    database.query(`SELECT reversed_at FROM payment_allocations WHERE id='a-fee'`),
    database.query(`SELECT paid_minor FROM documents WHERE id='d-fee'`),
  ]);
  assert.equal(journal.rows[0].status,'posted');
  assert.equal(reversal.rowCount,0);
  assert.equal(payment.rows[0].status,'posted');
  assert.equal(receipt.rows[0].status,'posted');
  assert.equal(allocation.rows[0].reversed_at,null);
  assert.equal(String(document.rows[0].paid_minor),'50');
});

pgtest('simultaneous salary payments serialize and cannot overpay payroll',async()=>{
  await reset();
  await database.query(`INSERT INTO payroll_lines(id,organization_id,net_minor,paid_minor,balance_minor,payment_status) VALUES('pl-1','o1',100,0,100,'unpaid')`);
  await database.query(`INSERT INTO payments(id,organization_id,amount_minor,status) VALUES('pay-1','o1',60,'posted'),('pay-2','o1',60,'posted')`);
  const payroll=new PayrollTransactions({database});
  const results=await Promise.allSettled([
    payroll.recordSalaryPayment({organizationId:'o1',payrollLineId:'pl-1',paymentId:'pay-1',amountMinor:60}),
    payroll.recordSalaryPayment({organizationId:'o1',payrollLineId:'pl-1',paymentId:'pay-2',amountMinor:60}),
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected'&&x.reason?.code==='PAYROLL_OVERPAYMENT').length,1);
  const line=await database.query(`SELECT paid_minor,balance_minor FROM payroll_lines WHERE id='pl-1'`);
  assert.deepEqual([String(line.rows[0].paid_minor),String(line.rows[0].balance_minor)],['60','40']);
});

pgtest('payroll overpayment rolls back and salary reversal restores the exact balance',async()=>{
  await reset();
  await database.query(`INSERT INTO payroll_lines(id,organization_id,net_minor,paid_minor,balance_minor,payment_status) VALUES('pl-1','o1',100,60,40,'partially_paid')`);
  await database.query(`INSERT INTO payments(id,organization_id,amount_minor,status) VALUES('pay-over','o1',60,'posted')`);
  const payroll=new PayrollTransactions({database});
  await assert.rejects(payroll.recordSalaryPayment({organizationId:'o1',payrollLineId:'pl-1',paymentId:'pay-over',amountMinor:60}),e=>e?.code==='PAYROLL_OVERPAYMENT');
  let line=await database.query(`SELECT paid_minor,balance_minor FROM payroll_lines WHERE id='pl-1'`);
  assert.deepEqual([String(line.rows[0].paid_minor),String(line.rows[0].balance_minor)],['60','40']);

  await database.query(`UPDATE payments SET amount_minor=40 WHERE id='pay-over'`);
  await payroll.recordSalaryPayment({organizationId:'o1',payrollLineId:'pl-1',paymentId:'pay-over',amountMinor:40,schoolStaffPayment:{id:'ssp-1',staffId:'staff-1',paymentDate:'2026-09-12',createdBy:'u1'}});
  await assert.rejects(payroll.reverseSalaryPayment({organizationId:'o1',paymentId:'pay-over',reason:'duplicate'}),e=>e?.code==='PAYMENT_NOT_REVERSED');
  await database.query(`UPDATE payments SET status='reversed' WHERE id='pay-over'`);
  const reversed=await payroll.reverseSalaryPayment({organizationId:'o1',paymentId:'pay-over',reason:'duplicate'});
  assert.deepEqual([String(reversed.paid_minor),String(reversed.balance_minor),reversed.payment_status],['60','40','partially_paid']);
  line=await database.query(`SELECT paid_minor,balance_minor,payment_status FROM payroll_lines WHERE id='pl-1'`);
  const link=await database.query(`SELECT status,reversed_at FROM school_staff_salary_payments WHERE id='ssp-1'`);
  assert.deepEqual([String(line.rows[0].paid_minor),String(line.rows[0].balance_minor),line.rows[0].payment_status],['60','40','partially_paid']);
  assert.equal(link.rows[0].status,'reversed');
  assert.ok(link.rows[0].reversed_at);
});

test('finance routes enforce write/read permission scopes before invoking business services',async()=>{
  const seen=[];let called=false;
  const auth={authenticateRequest:async()=>({organizationId:'o1',userId:'u1'}),requireScope(_principal,scope){seen.push(scope);throw Object.assign(new Error('forbidden'),{status:403,code:'FORBIDDEN'});}};
  const schoolRuntime={auth,extensions:{'finance-api':{schoolFees:{createFeeStructure:async()=>{called=true;}}}}};
  const schoolUrl=new URL('http://ledgerly/api/v1/school-fees/structures');
  await assert.rejects(schoolFeesRoute.handle({request:new Request(schoolUrl,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),url:schoolUrl,runtime:schoolRuntime,requestId:'r1'}),e=>e?.status===403);
  const payrollRuntime={auth,extensions:{'finance-api':{payroll:{employees:async()=>{called=true;return[];}}}}};
  const payrollUrl=new URL('http://ledgerly/api/v1/payroll/employees');
  await assert.rejects(payrollRoute.handle({request:new Request(payrollUrl),url:payrollUrl,runtime:payrollRuntime,requestId:'r2'}),e=>e?.status===403);
  assert.deepEqual(seen,['school:write','payroll:read']);
  assert.equal(called,false);
});

test('finance service invalidates tenant cache only after commit and never after rollback',async()=>{
  const invalidated=[];
  const cache={invalidateTag:async tag=>invalidated.push(tag)};
  const successDb={async transaction(work){return work({query:async()=>({rows:[],rowCount:1})});}};
  const service=new FinanceAccountsService({database:successDb,cache});
  await service.create('o1','u1',{code:'1000',name:'Cash',type:'asset',normalBalance:'debit'});
  assert.deepEqual(new Set(invalidated),new Set(['org:o1:accounts','org:o1:dashboard-summary','org:o1:reference-counts']));
  invalidated.length=0;
  const failedDb={async transaction(work){return work({query:async()=>{throw new Error('db failure');}});}};
  const failed=new FinanceAccountsService({database:failedDb,cache});
  await assert.rejects(failed.create('o1','u1',{code:'1001',name:'Bank',type:'asset',normalBalance:'debit'}),/db failure/);
  assert.deepEqual(invalidated,[]);
});
