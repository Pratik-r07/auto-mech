const ones = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n) {
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
}

function threeDigits(n) {
  let str = "";
  if (n > 99) {
    str += ones[Math.floor(n / 100)] + " Hundred";
    n = n % 100;
    if (n) str += " ";
  }
  if (n) str += twoDigits(n);
  return str;
}

export function numberToWordsINR(amount) {
  amount = Math.round(Number(amount || 0) * 100) / 100;
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  let num = rupees;
  let words = "";
  const crore = Math.floor(num / 10000000);
  num = num % 10000000;
  const lakh = Math.floor(num / 100000);
  num = num % 100000;
  const thousand = Math.floor(num / 1000);
  num = num % 1000;
  const hundred = num;

  if (crore) words += threeDigits(crore) + " Crore ";
  if (lakh) words += threeDigits(lakh) + " Lakh ";
  if (thousand) words += threeDigits(thousand) + " Thousand ";
  if (hundred) words += threeDigits(hundred);

  words = words.trim();
  let result = words ? words + " Rupees" : "";
  if (paise) result += (result ? " and " : "") + twoDigits(paise) + " Paise";
  return (result || "Zero Rupees") + " Only";
}
