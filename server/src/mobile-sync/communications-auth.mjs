function parseScopes(value){if(Array.isArray(value))return value;try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return[];}}
export async function canAccessCommunications(database,{organizationId,userId,level='read'}){
  const membership=await database.query(`SELECT role,scopes FROM memberships WHERE organization_id=$1 AND user_id=$2 LIMIT 1`,[organizationId,userId]);
  const row=membership.rows[0];
  if(!row)return false;
  if(row.role==='owner'||row.role==='admin')return true;
  const scopes=parseScopes(row.scopes);
  if(scopes.includes('communications:write')||(level==='read'&&scopes.includes('communications:read')))return true;
  const permission=`school.communications:${level==='read'?'read':'send'}`;
  try{
    const school=await database.query(`SELECT 1 FROM school_user_roles ur JOIN school_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id WHERE ur.organization_id=$1 AND ur.user_id=$2 AND rp.permission=$3 AND rp.effect='allow' AND (ur.starts_at IS NULL OR ur.starts_at<=now()) AND (ur.ends_at IS NULL OR ur.ends_at>=now()) UNION ALL SELECT 1 FROM school_temporary_permissions tp WHERE tp.organization_id=$1 AND tp.user_id=$2 AND tp.permission=$3 AND tp.revoked_at IS NULL AND tp.starts_at<=now() AND tp.ends_at>=now() LIMIT 1`,[organizationId,userId,permission]);
    return school.rowCount>0;
  }catch(error){if(error?.code==='42P01')return false;throw error;}
}
export async function requireCommunicationsAccess(database,context){if(!await canAccessCommunications(database,context)){const error=new Error('missing communications permission');error.code='SYNC_FORBIDDEN';error.status=403;throw error;}return true;}
