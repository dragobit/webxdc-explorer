import { useSeoMeta } from '@unhead/react';

const ExplorePage = () => {
  useSeoMeta({
    title: 'Explore · webxdc explorer',
    description: 'Search webxdc apps shared on Nostr (NIP-DC).',
  });

  return (
    <div className="py-16 text-center text-muted-foreground">
      Explore — under construction
    </div>
  );
};

export default ExplorePage;
