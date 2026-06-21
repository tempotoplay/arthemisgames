import { Link } from "react-router-dom";
import { games } from "../registry";

export function Gallery() {
  return (
    <main className="gallery">
      <header className="gallery__header">
        <h1>Arthemis Games</h1>
        <p>A small collection of client-side browser games. Pick one to play.</p>
      </header>

      <ul className="gallery__grid">
        {games.map((game) => (
          <li key={game.id}>
            <Link
              to={`/games/${game.id}`}
              className="card"
              style={{ ["--accent" as string]: game.accent }}
            >
              <span className="card__bar" />
              <h2 className="card__title">{game.title}</h2>
              <p className="card__desc">{game.description}</p>
              <span className="card__play">Play &rarr;</span>
            </Link>
          </li>
        ))}
      </ul>

      <footer className="gallery__footer">
        Built with React + Vite &middot;{" "}
        <a href="https://github.com/tempotoplay/arthemisgames">source</a>
      </footer>
    </main>
  );
}
