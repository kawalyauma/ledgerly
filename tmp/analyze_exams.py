import json, re, sys, unicodedata
from pathlib import Path
from difflib import SequenceMatcher

ROOT = Path(__file__).resolve().parents[1]
FILE_CLASS = {
    'marksheet-Baby.txt': 'Baby Class 2026',
    'marksheet-Middle.txt': 'Middle Class 2026',
    'marksheet-Top.txt': 'Top Class 2026',
    'marksheet-Primary-one.txt': 'Primary One 2026',
    'marksheet-Primary-2.txt': 'Primary Two 2026',
    'marksheet-Primary-three.txt': 'Primary Three 2026',
    'marksheet-Primary-four.txt': 'Primary Four 2026',
    'marksheet-Primary-five.txt': 'Primary Five 2026',
    'marksheet-Primary-six.txt': 'Primary Six 2026',
    'marksheet-Primary-seven.txt': 'Primary Seven 2026',
}

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii','ignore').decode().lower()
    return ' '.join(re.findall(r'[a-z]+', s))

def squash(s):
    s = norm(s).replace('ph','f')
    return re.sub(r'(.)\1+', r'\1', s.replace(' ',''))

def score(a,b):
    a,b=norm(a),norm(b)
    vals=[SequenceMatcher(None,a,b).ratio(), SequenceMatcher(None,' '.join(sorted(a.split())),' '.join(sorted(b.split()))).ratio(), SequenceMatcher(None,squash(a),squash(b)).ratio()]
    at,bt=a.split(),b.split()
    if len(at)==len(bt)==2:
        vals.append((SequenceMatcher(None,at[0],bt[0]).ratio()+SequenceMatcher(None,at[1],bt[1]).ratio())/2)
        vals.append((SequenceMatcher(None,at[0],bt[1]).ratio()+SequenceMatcher(None,at[1],bt[0]).ratio())/2)
    return round(max(vals)*100,1)

def parse_exams():
    rows=[]
    for fn, cls in FILE_CLASS.items():
        for line in (ROOT/'tmp/exam_text'/fn).read_text(errors='replace').splitlines():
            m=re.match(r'^\s*(\d+)\s{2,}(.+?)\s{2,}(\S+)\s{2,}(.+?)\s*$',line)
            if not m: continue
            idx,name,adm,tail=m.groups()
            # Student data lines have a numeric row and a trailing position/division block.
            if not re.search(r'(?:\d|—|\bX\b|\bU\b)',tail): continue
            parts=re.split(r'\s{2,}',tail.strip())
            rows.append({'class_name':cls,'row':int(idx),'name':name.strip(),'adm':adm.strip(),'x':bool(re.search(r'(^|\s)X(\s|$)',tail)),'tail':tail})
    return rows

def load_students():
    raw=json.loads((ROOT/'tmp/students_balances.json').read_text())
    return raw[0]['results']

def match_all(students, exams):
    unmatched_s=set(range(len(students))); unmatched_e=set(range(len(exams))); matches=[]
    # First take unique exact token matches globally. This also recovers archive-class students.
    bys={}; bye={}
    for i,s in enumerate(students): bys.setdefault(' '.join(sorted(norm(s['first_name']+' '+s['last_name']).split())),[]).append(i)
    for j,e in enumerate(exams): bye.setdefault(' '.join(sorted(norm(e['name']).split())),[]).append(j)
    for k,si in bys.items():
        ej=bye.get(k,[])
        if len(si)==len(ej)==1:
            i,j=si[0],ej[0]; matches.append((i,j,100.0,'exact')); unmatched_s.discard(i); unmatched_e.discard(j)
    # Greedy highest-confidence one-to-one matching globally. Same-class is the
    # tie-breaker, but names may legitimately appear under a different class.
    pairs=[]
    for i in unmatched_s:
        s=students[i]
        for j in unmatched_e:
            e=exams[j]
            sc=score(s['first_name']+' '+s['last_name'],e['name'])
            class_bonus = 3 if s['class_name']==e['class_name'] else 0
            pairs.append((sc+class_bonus,sc,i,j))
    pairs.sort(reverse=True)
    for _,sc,i,j in pairs:
        if sc < 80 or i not in unmatched_s or j not in unmatched_e: continue
        matches.append((i,j,sc,'fuzzy')); unmatched_s.remove(i); unmatched_e.remove(j)
    return matches,unmatched_s,unmatched_e

def main():
    students,exams=load_students(),parse_exams()
    matches,us,ue=match_all(students,exams)
    mm={i:(j,sc,kind) for i,j,sc,kind in matches}
    affected=[]
    for i,s in enumerate(students):
        if i in us: reason='absent_from_marksheet'
        elif exams[mm[i][0]]['x']: reason='exam_result_X'
        else: continue
        affected.append((s,reason,None if i in us else exams[mm[i][0]],None if i in us else mm[i][1]))
    if '--sql' in sys.argv:
        def q(v): return "'"+str(v).replace("'","''")+"'"
        vals=[]
        for s,reason,_,_ in affected:
            vals.append(f"({q(s['id'])},{q(s['student_number'])},{q(s['contact_id'])},{q(s['first_name']+' '+s['last_name'])},{q(reason)},{int(s['balance_minor'])})")
        target_cte="WITH targets(student_id,student_number,contact_id,student_name,reason,balance_minor) AS (VALUES\n"+",\n".join(vals)+"\n)\n"
        print(target_cte+"""
INSERT OR IGNORE INTO journal_entries(id,organization_id,entry_number,transaction_date,posting_date,description,reference,source_type,source_id,status,currency,exchange_rate_micros,posted_at,posted_by,idempotency_key,metadata,created_at,updated_at)
SELECT 'je_wd_'||student_number,'org_vgn5_ohw_gr7afuz','BD-2026-'||student_number,'2026-09-11','2026-09-11',
       'Bad debt write-off on withdrawal: '||student_name||' ('||student_number||')','BD-2026-'||student_number,
       'school_fee_writeoff',student_id,'posted','UGX',1000000,CURRENT_TIMESTAMP,'usr_t9wakyih6eduhvav',
       'withdrawal-bad-debt:'||student_number||':2026-09-11',json_object('studentId',student_id,'reason',reason,'source','last-term-exam-marksheets'),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM targets WHERE balance_minor>0;
""")
        print(target_cte+"""
INSERT OR IGNORE INTO journal_lines(id,organization_id,journal_entry_id,account_id,description,debit_minor,credit_minor,base_debit_minor,base_credit_minor,contact_id,dimensions_json,created_at,updated_at)
SELECT 'jl_wd_dr_'||student_number,'org_vgn5_ohw_gr7afuz','je_wd_'||student_number,'acc_a5wxm2q0twjgf6hz',
       'Bad debt write-off: '||student_name,balance_minor,0,balance_minor,0,contact_id,
       json_object('schoolStudentId',student_id,'reason',reason,'source','last-term-exam-marksheets'),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM targets WHERE balance_minor>0;
""")
        print(target_cte+"""
INSERT OR IGNORE INTO journal_lines(id,organization_id,journal_entry_id,account_id,description,debit_minor,credit_minor,base_debit_minor,base_credit_minor,contact_id,dimensions_json,created_at,updated_at)
SELECT 'jl_wd_cr_'||student_number,'org_vgn5_ohw_gr7afuz','je_wd_'||student_number,'acc_1i0gsxq8fz37l9ci',
       'Clear fees receivable on withdrawal: '||student_name,0,balance_minor,0,balance_minor,contact_id,
       json_object('schoolStudentId',student_id,'reason',reason,'source','last-term-exam-marksheets'),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM targets WHERE balance_minor>0;
""")
        print(target_cte+""",
doc_paid AS (
  SELECT document_id,SUM(amount_minor) paid_minor FROM payment_allocations
  WHERE organization_id='org_vgn5_ohw_gr7afuz' AND reversed_at IS NULL GROUP BY document_id
), charge_base AS (
  SELECT ch.*,t.student_number,t.reason,t.balance_minor,
         MAX(0,ch.total_minor-ch.credited_minor-ch.written_off_minor) net_minor,
         COALESCE(dp.paid_minor,0) doc_paid_minor
  FROM school_student_fee_charges ch JOIN targets t ON t.student_id=ch.student_id
  LEFT JOIN doc_paid dp ON dp.document_id=ch.document_id
  WHERE ch.organization_id='org_vgn5_ohw_gr7afuz' AND t.balance_minor>0
), charge_open AS (
  SELECT *,MAX(0,net_minor-MAX(0,doc_paid_minor-COALESCE(SUM(net_minor) OVER(PARTITION BY document_id ORDER BY charge_date,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0))) open_minor
  FROM charge_base
), alloc_calc AS (
  SELECT *,COALESCE(SUM(open_minor) OVER(PARTITION BY student_id ORDER BY charge_date,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prior_open
  FROM charge_open
), charge_alloc AS (
  SELECT *,MIN(open_minor,MAX(0,balance_minor-prior_open)) alloc_minor,
       ROW_NUMBER() OVER(PARTITION BY student_id ORDER BY charge_date,id) alloc_seq
  FROM alloc_calc WHERE open_minor>0
)
INSERT OR IGNORE INTO school_fee_writeoffs(id,organization_id,writeoff_number,student_id,charge_id,payer_contact_id,expense_account_id,receivable_account_id,amount_minor,writeoff_date,currency,reason,journal_entry_id,status,created_by,created_at,updated_at)
SELECT 'wo_wd_'||student_number||'_'||alloc_seq,'org_vgn5_ohw_gr7afuz','WO-2026-'||student_number||'-'||alloc_seq,
       student_id,id,payer_contact_id,'acc_a5wxm2q0twjgf6hz','acc_1i0gsxq8fz37l9ci',alloc_minor,'2026-09-11','UGX',
       CASE reason WHEN 'exam_result_X' THEN 'Withdrawn after receiving X in last-term examinations' ELSE 'Withdrawn because absent from last-term examination lists' END,
       'je_wd_'||student_number,'posted','usr_t9wakyih6eduhvav',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM charge_alloc WHERE alloc_minor>0;
""")

        print("""
UPDATE school_student_fee_charges AS ch SET
  written_off_minor=(SELECT COALESCE(SUM(w.amount_minor),0) FROM school_fee_writeoffs w WHERE w.charge_id=ch.id AND w.status='posted'),
  status=CASE WHEN ch.total_minor <= ch.credited_minor+
      (SELECT COALESCE(SUM(w.amount_minor),0) FROM school_fee_writeoffs w WHERE w.charge_id=ch.id AND w.status='posted')+
      COALESCE((SELECT SUM(pa.amount_minor) FROM payment_allocations pa WHERE pa.organization_id=ch.organization_id AND pa.document_id=ch.document_id AND pa.reversed_at IS NULL),0)
    THEN 'written_off' ELSE 'partially_settled' END,
  updated_at=CURRENT_TIMESTAMP
WHERE ch.id IN (SELECT charge_id FROM school_fee_writeoffs WHERE organization_id='org_vgn5_ohw_gr7afuz' AND id LIKE 'wo_wd_%');

UPDATE school_students SET status='withdrawn',updated_by='usr_t9wakyih6eduhvav',updated_at=CURRENT_TIMESTAMP
WHERE id IN ("""+",".join(q(a[0]['id']) for a in affected)+""");
""")
    else:
        print(f'students={len(students)} exams={len(exams)} matched={len(matches)} unmatched_students={len(us)} unmatched_exam_rows={len(ue)} affected={len(affected)}')
        print('\nLOW CONFIDENCE MATCHES (<88):')
        for i,j,sc,k in sorted(matches,key=lambda x:x[2]):
            if sc<88: print(f'{sc:5.1f} | {students[i]["class_name"] or "NO CLASS":22} | {students[i]["first_name"]} {students[i]["last_name"]} -> {exams[j]["name"]} [{exams[j]["class_name"]}, row {exams[j]["row"]}, X={exams[j]["x"]}]')
        print('\nUNMATCHED SYSTEM STUDENTS:')
        for i in sorted(us,key=lambda x:(students[x]['class_name'] or '',students[x]['first_name'])):
            s=students[i]; print(f'{s["class_name"] or "NO CLASS":22} | {s["student_number"]} | {s["first_name"]} {s["last_name"]} | balance={s["balance_minor"]}')
        print('\nUNMATCHED EXAM ROWS:')
        for j in sorted(ue,key=lambda x:(exams[x]['class_name'],exams[x]['row'])):
            e=exams[j]; print(f'{e["class_name"]:22} | row {e["row"]:2} | {e["name"]} | {e["adm"]} | X={e["x"]}')
        print('\nAFFECTED SUMMARY:')
        for reason in ('exam_result_X','absent_from_marksheet'):
            rows=[a for a in affected if a[1]==reason]
            pos=sum(1 for a in rows if int(a[0]['balance_minor'])>0); zero=sum(1 for a in rows if int(a[0]['balance_minor'])==0); neg=sum(1 for a in rows if int(a[0]['balance_minor'])<0)
            print(reason,len(rows),'positive',pos,'zero',zero,'credit',neg,'UGX positive total',sum(max(0,int(a[0]['balance_minor'])) for a in rows)//100)
        print('\nAFFECTED DETAIL:')
        for s,reason,e,sc in affected:
            print(f'{reason:22} | {s["student_number"]} | {s["first_name"]} {s["last_name"]} | {s["class_name"] or "NO CLASS"} | bal={int(s["balance_minor"])//100} UGX | match={e["name"] if e else "-"} | score={sc if sc is not None else "-"}')

if __name__=='__main__': main()
