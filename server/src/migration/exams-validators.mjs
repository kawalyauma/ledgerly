export const EXAMS_RELATIONSHIP_CHECKS = Object.freeze([
  {
    name: "exam_organization_exists",
    sql: `SELECT count(*)::bigint AS count FROM exm_exams e LEFT JOIN organizations o ON o.id=e.organization_id WHERE o.id IS NULL`,
  },
  {
    name: "exam_term_year",
    sql: `SELECT count(*)::bigint AS count
      FROM exm_exams e
      LEFT JOIN school_terms t ON t.id=e.term_id
      LEFT JOIN school_academic_years ay ON ay.id=e.academic_year_id
      WHERE (e.term_id IS NOT NULL AND (t.id IS NULL OR t.organization_id<>e.organization_id))
         OR (e.academic_year_id IS NOT NULL AND (ay.id IS NULL OR ay.organization_id<>e.organization_id))
         OR (t.id IS NOT NULL AND e.academic_year_id IS NOT NULL AND t.academic_year_id<>e.academic_year_id)`,
  },
  {
    name: "grading_scale_tenant",
    sql: `SELECT count(*)::bigint AS count
      FROM exm_exams e JOIN exm_grading_scales s ON s.id=e.grading_scale_id
      WHERE e.organization_id<>s.organization_id`,
  },
  {
    name: "grade_band_tenant",
    sql: `SELECT count(*)::bigint AS count
      FROM exm_grade_bands b JOIN exm_grading_scales s ON s.id=b.grading_scale_id
      WHERE b.organization_id<>s.organization_id`,
  },
  {
    name: "exam_class_tenant",
    sql: `SELECT count(*)::bigint AS count
      FROM exm_exam_classes x
      JOIN exm_exams e ON e.id=x.exam_id
      JOIN school_classes c ON c.id=x.class_id
      LEFT JOIN school_streams st ON st.id=x.stream_id
      WHERE x.organization_id<>e.organization_id
         OR c.organization_id<>x.organization_id
         OR (st.id IS NOT NULL AND (st.organization_id<>x.organization_id OR st.class_id<>x.class_id))`,
  },
  {
    name: "exam_subject_relation",
    sql: `SELECT count(*)::bigint AS count
      FROM exm_exam_subjects s
      JOIN exm_exams e ON e.id=s.exam_id
      JOIN school_classes c ON c.id=s.class_id
      JOIN school_subjects u ON u.id=s.subject_id
      WHERE s.organization_id<>e.organization_id
         OR c.organization_id<>s.organization_id
         OR u.organization_id<>s.organization_id`,
  },
  {
    name: "mark_relation",
    sql: `SELECT count(*)::bigint AS count
      FROM exm_marks m
      JOIN exm_exams e ON e.id=m.exam_id
      JOIN exm_exam_subjects es ON es.id=m.exam_subject_id
      JOIN school_students st ON st.id=m.student_id
      JOIN school_classes c ON c.id=m.class_id
      JOIN school_subjects su ON su.id=m.subject_id
      WHERE m.organization_id<>e.organization_id
         OR es.organization_id<>m.organization_id
         OR es.exam_id<>m.exam_id
         OR es.class_id<>m.class_id
         OR es.subject_id<>m.subject_id
         OR st.organization_id<>m.organization_id
         OR c.organization_id<>m.organization_id
         OR su.organization_id<>m.organization_id`,
  },
  {
    name: "mark_range",
    sql: `SELECT count(*)::bigint AS count
      FROM exm_marks m JOIN exm_exam_subjects es ON es.id=m.exam_subject_id
      WHERE m.marks_obtained IS NOT NULL AND (m.marks_obtained<0 OR m.marks_obtained>es.max_mark)`,
  },
  {
    name: "mark_absent_exempt_conflict",
    sql: `SELECT count(*)::bigint AS count FROM exm_marks WHERE is_absent AND is_exempt`,
  },
  {
    name: "duplicate_marks",
    sql: `SELECT count(*)::bigint AS count FROM (SELECT exam_id,student_id,subject_id FROM exm_marks GROUP BY 1,2,3 HAVING count(*)>1) d`,
  },
  {
    name: "card_relation",
    sql: `SELECT count(*)::bigint AS count
      FROM exm_report_cards r
      JOIN exm_exams e ON e.id=r.exam_id
      JOIN school_students s ON s.id=r.student_id
      JOIN school_classes c ON c.id=r.class_id
      LEFT JOIN school_streams st ON st.id=r.stream_id
      WHERE r.organization_id<>e.organization_id
         OR s.organization_id<>r.organization_id
         OR c.organization_id<>r.organization_id
         OR (st.id IS NOT NULL AND (st.organization_id<>r.organization_id OR st.class_id<>r.class_id))`,
  },
  {
    name: "published_consistency",
    sql: `SELECT count(*)::bigint AS count FROM exm_report_cards
      WHERE (is_published AND published_at IS NULL) OR (NOT is_published AND published_at IS NOT NULL)`,
  },
]);
