import { Blobatar } from "blobatar/react";
import type { CSSProperties } from "react";

type ActorArtworkProps = {
  name: string;
  className?: string;
};

export default function ActorArtwork({
  name,
  className = "h-[60px] w-[60px]",
}: ActorArtworkProps) {
  return (
    <>
      <Blobatar
        className={`actor-artwork-light ${className}`}
        name={name}
        animate="always"
        background={false}
        aria-hidden="true"
      />
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        aria-hidden="true"
        className={`actor-artwork-dark ${className}`}
        style={
          {
            "--mo-phase": "-1938ms",
            "--mo-bob-phase": "-1277ms",
            "--mo-blink": "3908ms",
            "--mo-blink-phase": "-818ms",
            "--mo-look-x": 1.23,
            "--mo-look-mx": 1.23,
            "--mo-look-y": 1.3,
            "--mo-look-my": 1.3,
            "--mo-saccade": "7575ms",
            "--mo-saccade-phase": "-2871ms",
            "--mo-head": "#00dfa3",
            "--mo-eye": "#083344",
          } as CSSProperties
        }
      >
        <g className="mo-root mo-always">
          <g className="mo-breathe">
            <g className="mo-bob">
              <g fill="#00dfa3">
                <path d="M89.06 51.24C89.06 72.47 71.44 91.16 51.42 91.16C31.41 91.16 13.79 72.47 13.79 51.24C13.79 30.01 31.41 11.32 51.42 11.32C71.44 11.32 89.06 30.01 89.06 51.24Z" />
              </g>
              <g fill="#083344" className="mo-eyes">
                <g
                  className="mo-eye"
                  style={
                    {
                      "--mo-wrap": -1,
                      "--mo-lean": -7.13,
                      transformOrigin: "42.29px 45.43px",
                    } as CSSProperties
                  }
                >
                  <path d="M46.08 44.95C47.05 52.64 47.05 52.64 43.26 53.12C39.47 53.59 39.47 53.59 38.5 45.9C37.54 38.21 37.54 38.21 41.33 37.74C45.12 37.26 45.12 37.26 46.08 44.95Z" />
                </g>
                <g
                  className="mo-eye"
                  style={
                    {
                      "--mo-wrap": 1,
                      "--mo-lean": -5.58,
                      transformOrigin: "64.26px 45.7px",
                    } as CSSProperties
                  }
                >
                  <path d="M67.62 45.37C68.3 52.29 68.3 52.29 64.93 52.61C61.57 52.94 61.57 52.94 60.89 46.03C60.21 39.12 60.21 39.12 63.58 38.79C66.95 38.46 66.95 38.46 67.62 45.37Z" />
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </>
  );
}
