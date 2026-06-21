import { Link, useParams } from "react-router-dom";
import { gameById } from "../registry";

export function GamePage() {
  const { id } = useParams();
  const game = gameById(id);

  if (!game) {
    return (
      <main className="boot">
        <p>No such game.</p>
        <Link to="/">&larr; Back to the gallery</Link>
      </main>
    );
  }

  const { Component } = game;

  return (
    <div className="game-screen">
      <nav className="game-screen__nav">
        <Link to="/" className="game-screen__back">
          &larr; Gallery
        </Link>
        <span className="game-screen__title">{game.title}</span>
      </nav>
      <div className="game-screen__stage">
        <Component />
      </div>
    </div>
  );
}
