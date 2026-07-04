// Bank logo lookup for credit cards. Official SVGs live in /static/banks
// (sourced from Wikimedia Commons, PR-CL21). Unknown issuers fall back to a
// colored monogram chip so the UI never breaks on a new bank.
const BANKS = [
  { re: /bca|central asia/i,  src: '/banks/bca.svg',     alt: 'BCA' },
  { re: /bni|negara/i,        src: '/banks/bni.svg',     alt: 'BNI' },
  { re: /bri|rakyat/i,        src: '/banks/bri.svg',     alt: 'BRI' },
  { re: /mandiri/i,           src: '/banks/mandiri.svg', alt: 'Mandiri' },
  { re: /cimb|niaga/i,        src: '/banks/cimb.svg',    alt: 'CIMB Niaga' },
  { re: /mega/i,              src: '/banks/mega.svg',    alt: 'Bank Mega' },
  { re: /jenius|btpn|smbc/i,  src: null, initials: 'J', bg: '#111111', fg: '#ffffff', alt: 'Jenius' }
];

/** Resolve a card's bank branding from its issuer and/or card name. */
export function bankLogo(issuer, cardName = '') {
  const hay = `${issuer || ''} ${cardName || ''}`;
  for (const b of BANKS) {
    if (b.re.test(hay)) return b;
  }
  const init = (issuer || cardName || '?').trim().charAt(0).toUpperCase();
  return { src: null, initials: init, bg: '#2a2a32', fg: '#f5f6f7', alt: issuer || cardName || 'Bank' };
}
