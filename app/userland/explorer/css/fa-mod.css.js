import { css } from 'lit';

const cssStr = css`
  .fa-mod {
    position: relative;
    margin-right: 3px;
  }

  .fa-mod :last-child {
    position: absolute;
    font-size: 50%;
    top: 42%;
    right: 4px;
  }
`;
export default cssStr;
