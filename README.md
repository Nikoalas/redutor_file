# Bancada de PDF

Ferramenta web para **reduzir o tamanho de arquivos PDF** direto no navegador, preparando o documento para protocolo e assinatura digital.

> 🔒 **Privacidade:** o arquivo não sai do seu navegador. Todo o processamento acontece localmente, sem envio a nenhum servidor.

## Como o projeto começou

O projeto nasceu de um problema real no **cartório onde trabalho**. Os documentos digitalizados, em especial os arquivos maiores, ocupavam muito espaço de armazenamento e dificultavam o envio e o protocolo. Era necessário **diminuir o peso desses PDFs** sem comprometer a leitura e a validade do documento.

Em vez de depender de serviços online (que exigiriam enviar documentos sensíveis para servidores de terceiros), a solução foi criar uma ferramenta própria que roda inteiramente no computador do usuário.

## Funcionalidades

- Redução do peso do PDF para economizar armazenamento
- Preservação do texto do documento
- Limpeza de metadados
- Aviso quando o PDF parece já estar assinado digitalmente (já que alterá-lo pode invalidar a assinatura)
- Suporte a arquivos grandes, na casa das centenas de MB (quanto maior o arquivo, mais tempo leva)
- Seleção do arquivo por clique ou arrastando para a página

## Tecnologias

| Tecnologia | Uso |
| --- | --- |
| **HTML5** | Estrutura da página e fluxo em etapas |
| **CSS3** | Layout responsivo e identidade visual |
| **JavaScript (puro)** | Lógica da aplicação e processamento do PDF no navegador |
| **Google Fonts** | Tipografia (Bricolage Grotesque) |
| **Git e GitHub** | Controle de versão e hospedagem do código |

## Como usar

1. Acesse a página (ou abra o `index.html` no navegador).
2. Escolha o PDF, clicando na área indicada ou arrastando o arquivo.
3. Aguarde o processamento.
4. Baixe o arquivo reduzido.

## Executando localmente

```bash
git clone https://github.com/Nikoalas/redutor_file.git
cd redutor_file
```

Depois, basta abrir o arquivo `index.html` no navegador. Não é necessário instalar dependências nem rodar um servidor.

## Estrutura do projeto

```
redutor_file/
├── index.html   # Estrutura da página
├── style.css    # Estilos
├── app.js       # Lógica da aplicação
└── .gitignore
```

## Aviso

Se o PDF possuir **assinatura digital**, a compressão pode invalidá-la. Comprima o documento **antes** de assinar.

## Autor

Desenvolvido por [Nikoalas](https://github.com/Nikoalas).
