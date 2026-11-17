import { describe, expect, it, test } from "bun:test";

import { detalhesDoErro, semCredencial } from "./detalhes.puro";

describe("semCredencial", () => {
  test("mascara senha em URI mantendo usuário e host", () => {
    expect(semCredencial("falhou postgres://app:S3cr3t!@db:5432/x")).toBe("falhou postgres://app:***@db:5432/x");
  });
  test("mascara chave=valor de connection string e JSON", () => {
    expect(semCredencial("host=a password=abc user=b")).toBe("host=a password=*** user=b");
    expect(semCredencial('{"password":"abc","x":1}')).toBe('{"password":"***","x":1}');
    expect(semCredencial("senha: 123")).toBe("senha: ***");
  });
  test("mascara bearer e cookie de sessão", () => {
    expect(semCredencial("Authorization: Bearer abc.def")).toBe("Authorization: Bearer ***");
    expect(semCredencial("dbee_session=xyz; a=1")).toBe("dbee_session=***; a=1");
  });
  test("texto comum passa intacto", () => {
    const s = "TypeError: Cannot read properties of undefined (reading 'x')";
    expect(semCredencial(s)).toBe(s);
  });
});

describe("detalhesDoErro", () => {
  test("junta tudo e passa pelo filtro", () => {
    const t = detalhesDoErro({
      nome: "Error",
      mensagem: "conexão mysql://root:pw@h falhou",
      pilha: "at x",
      pilhaComponente: null,
      caminho: "/",
      agente: "Chrome",
    });
    expect(t).toContain("mysql://root:***@h");
    expect(t).not.toContain("pw@");
    expect(t).toContain("em / · Chrome");
  });
});

describe("semCredencial — formas da revisão de segurança", () => {
  it("password citada com aspas simples ou duplas", () => {
    expect(semCredencial("host=h password='s3gr3do' dbname=x")).toBe("host=h password='***' dbname=x");
    expect(semCredencial('{"password": "s3 gr3do"}')).toBe('{"password": "***"}');
  });
  it("URI com / e @ na senha mascara até o último @", () => {
    expect(semCredencial("postgres://u:ab/cd@h:5432/db")).toBe("postgres://u:***@h:5432/db");
    expect(semCredencial("falhou postgres://u:p@ss@h/db agora")).toBe("falhou postgres://u:***@h/db agora");
  });
  it("forma sem aspas continua mascarada", () => {
    expect(semCredencial("password=abc123;host=h")).toBe("password=***;host=h");
  });
});
