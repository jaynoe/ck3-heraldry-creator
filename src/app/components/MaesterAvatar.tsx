/** The Maester's little portrait: an old man with a long beard and his chain of many metals. */
export function MaesterAvatar({ thinking }: { thinking?: boolean }) {
  return (
    <span className="maester-avatar" data-thinking={thinking || undefined} aria-hidden>
      <svg viewBox="0 0 64 64" width="56" height="56">
        <rect width="64" height="64" fill="#1c170d" />
        <path d="M-4 12L12-4M-4 28L28-4M-4 44L44-4M20 68L68 20M36 68L68 36M52 68L68 52" stroke="#2f281a" strokeWidth="2" />
        <path d="M4 64C5 51 17 45 32 45C47 45 59 51 60 64Z" fill="#5a5348" />
        <path d="M14 64L17 53M22 64L24 51M42 51L44 64M47 53L50 64" stroke="#38332b" strokeWidth="1.6" />
        <g className="maester-avatar-head">
                    <path d="M20 22C20 12 25 7 32 7C39 7 44 12 44 22V34H20Z" fill="#dcc9a4" />
          <path d="M26 11C28 9.5 31 9 34 9.5M25 14.5C26 13.5 27 13 28 12.8" stroke="#f0e2c4" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M18.5 28C16.5 24 17 19 20 16C20 20 20.5 23 21.5 26ZM45.5 28C47.5 24 47 19 44 16C44 20 43.5 23 42.5 26Z" fill="#efe8d8" />
          <path d="M23 21.5C25 19.8 27.5 19.8 29.5 21.2M34.5 21.2C36.5 19.8 39 19.8 41 21.5" stroke="#efe8d8" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <circle cx="26.5" cy="24" r="1.5" fill="#14110d" />
          <circle cx="37.5" cy="24" r="1.5" fill="#14110d" />
          <path d="M32 24.5L30.3 30H33.7Z" fill="#bfa982" />
          <path d="M20 28C19 42 25 54 32 57C39 54 45 42 44 28C42 31 38 32 36 31C34 30.5 30 30.5 28 31C26 32 22 31 20 28Z" fill="#efe8d8" />
          <path d="M28.5 33.5Q32 35.5 35.5 33.5" stroke="#7d7466" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M25 37L27 47M30 38L31 51M34 38L33 51M39 37L37 47" stroke="#b5ad9e" strokeWidth="1.1" strokeLinecap="round" />
        </g>
        <g strokeWidth="1.6" fill="none">
          <circle cx="11" cy="53" r="2.4" stroke="#c9a24e" />
          <circle cx="15" cy="56.5" r="2.4" stroke="#a7a198" />
          <circle cx="19.5" cy="59" r="2.4" stroke="#a9713a" />
          <circle cx="24.5" cy="60.5" r="2.4" stroke="#c9a24e" />
          <circle cx="39.5" cy="60.5" r="2.4" stroke="#a7a198" />
          <circle cx="44.5" cy="59" r="2.4" stroke="#c9a24e" />
          <circle cx="49" cy="56.5" r="2.4" stroke="#a9713a" />
          <circle cx="53" cy="53" r="2.4" stroke="#a7a198" />
        </g>
      </svg>
    </span>
  );
}
