/* eslint-disable @next/next/no-img-element */
// The wordmark: the provided spray-paint PNG. Where luminance masking is
// supported, the PNG becomes a mask and an animated white↔black gradient
// sweeps through the letterforms; elsewhere the plain image shows.
export default function Logo() {
  return (
    <header className="masthead" aria-label="Crashout">
      <div className="logo-wrap">
        <img className="logo-img" src="/logo.png" alt="CRASHOUT" />
        <div className="logo-masked" role="presentation" />
        <span className="uk-tag">UK</span>
      </div>
      <p className="tagline">the anonymous wall of rage</p>
    </header>
  );
}
