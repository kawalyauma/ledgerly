export const SCHOOL_FEE_REFERENCE_RELATIONSHIP_CHECKS=Object.freeze([
 ["school_fee_ref.structure_year_tenant",`SELECT count(*)::bigint AS count FROM school_fee_structures x JOIN school_academic_years p ON p.id=x.academic_year_id WHERE p.organization_id<>x.organization_id`],
 ["school_fee_ref.line_structure",`SELECT count(*)::bigint AS count FROM school_fee_structure_lines x LEFT JOIN school_fee_structures p ON p.id=x.structure_id WHERE p.id IS NULL`],
 ["school_fee_ref.line_category_tenant",`SELECT count(*)::bigint AS count FROM school_fee_structure_lines x JOIN school_fee_categories p ON p.id=x.fee_category_id WHERE p.organization_id<>x.organization_id`],
 ["school_fee_ref.discount_category_tenant",`SELECT count(*)::bigint AS count FROM school_fee_discount_schemes x JOIN school_fee_categories p ON p.id=x.fee_category_id WHERE x.fee_category_id IS NOT NULL AND p.organization_id<>x.organization_id`],
]);
