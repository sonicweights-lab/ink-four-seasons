import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Seasons, SEASONS_FRAMES } from './Seasons';

const Root: React.FC = () => (
  <Composition id="InkSeasons" component={Seasons} durationInFrames={SEASONS_FRAMES} fps={30} width={1080} height={1920} />
);
registerRoot(Root);
