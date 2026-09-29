// A generated marketing image from the manifest: WebP in several widths (srcset) with a JPEG fallback, intrinsic
// size (no layout shift), the manifest's alt text, lazy by default. Art direction per placement is done with
// object-position in CSS; `sizes` says how wide the image is drawn so a phone never downloads the desktop file.
import type { MarketingImage } from 'virtual:headcount-landing';

export function srcsetOf(image: MarketingImage): string {
  const set = image.srcset?.length ? image.srcset : [{ width: image.width, file: image.file }];
  return set.map((s) => `${s.file} ${s.width}w`).join(', ');
}

export function Picture({ image, priority = false, class: cls, sizes = '(max-width: 767px) 100vw, 50vw', decorative = false }: { image: MarketingImage; priority?: boolean; class?: string; sizes?: string; decorative?: boolean }) {
  return (
    <picture>
      <source type="image/webp" srcset={srcsetOf(image)} sizes={sizes} />
      <img
        class={cls}
        src={image.fallback ?? image.file}
        width={image.width}
        height={image.height}
        alt={decorative ? '' : image.alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        {...(priority ? { fetchpriority: 'high' } : {})}
      />
    </picture>
  );
}
