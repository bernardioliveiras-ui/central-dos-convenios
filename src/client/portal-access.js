export function adminAccessView(profile){
  const isAdmin=profile.role==='ADMIN';
  return {
    challenge:isAdmin&&profile.mfaEnabled===true&&profile.mfaRequired===true,
    offerEnrollment:isAdmin&&profile.mfaEnabled===false
  };
}
