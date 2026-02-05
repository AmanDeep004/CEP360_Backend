//masking phone no in the format of 98********23
export const maskPhone = (phone) => {
  if (!phone) return null;
  const str = phone.toString();
  if (str.length < 6) return "******";
  return str.slice(0, 2) + "******" + str.slice(-2);
};

//masking email in the format of abc****@gmail.com
export const maskEmail = (email) => {
  if (!email || !email.includes("@")) return null;
  const [name, domain] = email.split("@");
  const domainParts = domain.split(".");

  const mainDomain = domainParts[0]; // gmail
  const tld = domainParts.slice(1).join("."); // com / co.in

  const maskedName = name.length <= 3 ? "***" : name.slice(0, 3) + "****";
  //   console.log(maskedName, "MASKEDANAME");

  let maskedDomain;
  if (mainDomain.length <= 3) {
    maskedDomain = "***";
  } else {
    maskedDomain = mainDomain.slice(0, 2) + "****" + mainDomain.slice(-1);
  }

  return `${maskedName}@${maskedDomain}.${tld}`;
};

// export const maskEmail = (email) => {
//   if (!email) return null;
//   const [name, domain] = email.split("@");
//   if (name.length <= 3) return "***@" + domain;
//   return name.slice(0, 3) + "****@" + domain;
// };
